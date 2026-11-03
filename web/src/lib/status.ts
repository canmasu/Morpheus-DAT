import { type Abi, type Address, parseAbi, stringToHex, zeroAddress } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig, StakeAsset } from '@/config/networks';
import { contractsFor } from './partner';
import { quoteMorClaimFee } from './mor';
import { publicClient, write } from './tx';

const dpAbi = parseAbi([
  'function version() view returns (uint256)',
  'function distributor() view returns (address)',
  'function rewardPoolsProtocolDetails(uint256) view returns (uint128, uint128, uint128, uint256, uint256)',
  'function getLatestReferrerReward(uint256, address) view returns (uint256)',
  'function claimReferrerTier(uint256, address) payable',
]);
const l1SenderAbi = parseAbi(['function layerZeroConfig() view returns (address, address, uint16, address, bytes)']);

export type AssetStatus = {
  asset: StakeAsset;
  version?: bigint;
  live?: { withdrawLock: bigint; claimLockAfterStake: bigint; claimLockAfterClaim: bigint; minimalStake: bigint };
  healthy?: boolean;
  referralPending?: bigint;
  error?: string;
};

export type MorpheusStatus = {
  assets: AssetStatus[];
  lz: { adapterParams?: string; fee?: bigint; ok: boolean };
  dat?: {
    adapter: Address;
    exitOnly: boolean;
    depositsPaused: boolean;
    allPaused: boolean;
    feeBps: number;
    feeWallet: Address;
    referral: Address;
  };
};

export async function readStatus(net: NetworkConfig): Promise<MorpheusStatus> {
  const c = publicClient(net.l1);
  const { factory } = contractsFor(net);

  let dat: MorpheusStatus['dat'];
  if (factory) {
    const f = { address: factory, abi: A.PoolFactory.abi } as const;
    const [adapter, depositsPaused, allPaused, feeBps, feeWallet, referral] = await Promise.all([
      c.readContract({ ...f, functionName: 'adapter' }),
      c.readContract({ ...f, functionName: 'depositsPaused' }),
      c.readContract({ ...f, functionName: 'allPaused' }),
      c.readContract({ ...f, functionName: 'feeBps' }),
      c.readContract({ ...f, functionName: 'feeWallet' }),
      c.readContract({ ...f, functionName: 'referralAddress' }),
    ]);
    const exitOnly = await c.readContract({ address: adapter, abi: A.MorpheusAdapter.abi, functionName: 'isExitOnly' });
    dat = { adapter, exitOnly, depositsPaused, allPaused, feeBps: Number(feeBps), feeWallet, referral };
  }

  const assets = await Promise.all(
    net.stakeAssets.map(async (asset): Promise<AssetStatus> => {
      const dp = { address: asset.depositPool, abi: dpAbi } as const;
      const idx = BigInt(asset.poolIndex);
      try {
        const [version, details, healthy, referralPending] = await Promise.all([
          c.readContract({ ...dp, functionName: 'version' }),
          c.readContract({ ...dp, functionName: 'rewardPoolsProtocolDetails', args: [idx] }),
          dat ? c.readContract({ address: dat.adapter, abi: A.MorpheusAdapter.abi, functionName: 'isHealthy', args: [asset.depositPool] }) : undefined,
          dat ? c.readContract({ ...dp, functionName: 'getLatestReferrerReward', args: [idx, dat.referral] }).catch(() => undefined) : undefined,
        ]);
        const [withdrawLock, claimLockAfterStake, claimLockAfterClaim, minimalStake] = details;
        return { asset, version, live: { withdrawLock, claimLockAfterStake, claimLockAfterClaim, minimalStake }, healthy, referralPending };
      } catch (e) {
        return { asset, error: (e as Error).message.split('\n')[0] };
      }
    }),
  );

  let lz: MorpheusStatus['lz'] = { ok: false };
  try {
    const cfg = await c.readContract({ address: net.morpheus.l1Sender, abi: l1SenderAbi, functionName: 'layerZeroConfig' });
    lz = { adapterParams: cfg[4], ok: false };
    lz.fee = await quoteMorClaimFee(net);
    lz.ok = true;
  } catch {
    // quote failed: MOR claims would revert
  }

  return { assets, lz, dat };
}

/** Morpheus referral MOR is claimed by the referrer wallet itself; it is minted to `receiver` on Arbitrum. */
export const claimReferralMor = (net: NetworkConfig, me: Address, asset: StakeAsset, receiver: Address, fee: bigint) =>
  write(net.l1, me, asset.depositPool, dpAbi as Abi, 'claimReferrerTier', [BigInt(asset.poolIndex), receiver], (fee * 12n) / 10n);

const buildersAbi = parseAbi([
  'function version() view returns (uint256)',
  'function depositToken() view returns (address)',
  'function rewardPool() view returns (address)',
  'function feeConfig() view returns (address)',
  'function minimalWithdrawLockPeriod() view returns (uint256)',
  'function subnetCreationFeeAmount() view returns (uint256)',
  'function networkShare() view returns (uint256)',
  'function allSubnetsData() view returns (uint256, uint256, uint256, uint256)',
]);
const rewardPoolAbi = parseAbi(['function getPeriodRewards(uint256, uint128, uint128) view returns (uint256)']);
const feeConfigAbi = parseAbi(['function getFeeAndTreasuryForOperation(address, bytes32) view returns (uint256, address)']);

/** Morpheus's own precision: 1e25 = 100%. */
const PRECISION = 10n ** 25n;
/** The Builders bucket in Morpheus's RewardPool, as hard-coded in BuildersV4. */
const BUILDERS_REWARD_POOL = 3n;

export type BuildersStatus = {
  contract: Address;
  version: bigint;
  withdrawLock: bigint;
  creationFee: bigint;
  /** Share of the Builders emission that goes to subnets on this chain, 1 = 100%. */
  networkShare: number;
  /** Morpheus's cut of each subnet claim, 1 = 100%. Undefined if its fee config cannot be read. */
  claimFee?: number;
  totalStaked: bigint;
  morPerDay: bigint;
  /** MOR a year per MOR staked, earned by the subnet. Falls as more MOR is staked. */
  yearlyRate: number;
  /** Undefined until DAT is deployed on Base. */
  dat?: { healthy: boolean; exitOnly: boolean; depositsPaused: boolean; allPaused: boolean; pools: bigint };
};

/** Live state of Morpheus Builders. `net` is the Base view of a network. */
export async function readBuildersStatus(net: NetworkConfig): Promise<BuildersStatus> {
  const c = publicClient(net.l1);
  const contract = net.builders!.contract;
  if (contract === zeroAddress) throw new Error('The simulated Builders is not deployed yet: run the Base steps on the deploy page.');
  const b = { address: contract, abi: buildersAbi } as const;
  const [version, rewardPool, feeConfig, withdrawLock, creationFee, share, all, block] = await Promise.all([
    c.readContract({ ...b, functionName: 'version' }),
    c.readContract({ ...b, functionName: 'rewardPool' }),
    c.readContract({ ...b, functionName: 'feeConfig' }),
    c.readContract({ ...b, functionName: 'minimalWithdrawLockPeriod' }),
    c.readContract({ ...b, functionName: 'subnetCreationFeeAmount' }),
    c.readContract({ ...b, functionName: 'networkShare' }),
    c.readContract({ ...b, functionName: 'allSubnetsData' }),
    c.getBlock(),
  ]);
  const totalStaked = all[2];
  const emission = await c.readContract({
    address: rewardPool,
    abi: rewardPoolAbi,
    functionName: 'getPeriodRewards',
    args: [BUILDERS_REWARD_POOL, block.timestamp - 86400n, block.timestamp],
  });
  const morPerDay = (emission * share) / PRECISION;
  const claimFee = await c
    .readContract({ address: feeConfig, abi: feeConfigAbi, functionName: 'getFeeAndTreasuryForOperation', args: [contract, stringToHex('claim', { size: 32 })] })
    .then(([part]) => Number(part) / Number(PRECISION))
    .catch(() => undefined);

  let dat: BuildersStatus['dat'];
  const { factory } = contractsFor(net);
  if (factory) {
    const f = { address: factory, abi: A.PoolFactory.abi } as const;
    const [adapter, depositsPaused, allPaused, pools] = await Promise.all([
      c.readContract({ ...f, functionName: 'adapter' }),
      c.readContract({ ...f, functionName: 'depositsPaused' }),
      c.readContract({ ...f, functionName: 'allPaused' }),
      c.readContract({ ...f, functionName: 'poolCount' }),
    ]);
    const a = { address: adapter, abi: A.BuildersAdapter.abi } as const;
    const [healthy, exitOnly] = await Promise.all([
      c.readContract({ ...a, functionName: 'isHealthy', args: [contract] }),
      c.readContract({ ...a, functionName: 'isExitOnly' }),
    ]);
    dat = { healthy, exitOnly, depositsPaused, allPaused, pools };
  }

  return {
    contract,
    version,
    withdrawLock,
    creationFee,
    networkShare: Number(share) / Number(PRECISION),
    claimFee,
    totalStaked,
    morPerDay,
    yearlyRate: totalStaked === 0n ? 0 : (Number(morPerDay) * 365) / Number(totalStaked),
    dat,
  };
}
