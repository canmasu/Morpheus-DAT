import { type Abi, type Address, parseAbi } from 'viem';
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
