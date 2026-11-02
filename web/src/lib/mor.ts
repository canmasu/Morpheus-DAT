import { type Abi, type Address, encodeAbiParameters, erc20Abi, parseAbi } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig } from '@/config/networks';
import { publicClient, write } from './tx';

const l1SenderAbi = parseAbi(['function layerZeroConfig() view returns (address, address, uint16, address, bytes)']);
const lzEndpointAbi = parseAbi(['function estimateFees(uint16, address, bytes, bool, bytes) view returns (uint256, uint256)']);
const depositPoolAbi = parseAbi([
  'function usersData(address, uint256) view returns (uint128, uint256, uint256, uint256, uint128, uint128, uint256, uint128, address)',
  'function rewardPoolsProtocolDetails(uint256) view returns (uint128, uint128, uint128, uint256, uint256)',
  'function getLatestUserReward(uint256, address) view returns (uint256)',
]);

/** LayerZero fee for one MOR claim, quoted from Morpheus's own L1Sender config. Throws if Morpheus's LayerZero
 * setup cannot send at all (the case on Morpheus Sepolia today). */
export async function quoteMorClaimFee(net: NetworkConfig): Promise<bigint> {
  const c = publicClient(net.l1);
  const [gateway, , dstChainId, , adapterParams] = await c.readContract({
    address: net.morpheus.l1Sender,
    abi: l1SenderAbi,
    functionName: 'layerZeroConfig',
  });
  const payload = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], ['0x000000000000000000000000000000000000dEaD', 10n ** 18n]);
  const [nativeFee] = await c.readContract({
    address: gateway,
    abi: lzEndpointAbi,
    functionName: 'estimateFees',
    args: [dstChainId, net.morpheus.l1Sender, payload, false, adapterParams],
  });
  return nativeFee;
}

export type AccountMor = {
  account: Address;
  sleeveId: number;
  epochId: number;
  lockOptionId: number;
  symbol: string;
  decimals: number;
  inMorpheus: boolean;
  deposited: bigint;
  pending: bigint;
  /** First second Morpheus accepts a claim: after the stake lock, the claim-after-claim gap and any boost lock. */
  claimableAt: bigint;
  boostedUntil: bigint;
};

export async function accountsMor(net: NetworkConfig, vault: Address): Promise<AccountMor[]> {
  const c = publicClient(net.l1);
  const v = { address: vault, abi: A.PoolVault.abi } as const;
  const count = await c.readContract({ ...v, functionName: 'accountCount' });
  const out: AccountMor[] = [];
  for (let i = 0n; i < count; i++) {
    const account = await c.readContract({ ...v, functionName: 'accounts', args: [i] });
    const [, inMorpheus, , sleeveId, lockOptionId, epochId] = await c.readContract({ ...v, functionName: 'accountInfo', args: [account] });
    const sleeve = await c.readContract({ ...v, functionName: 'sleeve', args: [BigInt(sleeveId)] });
    const asset = net.stakeAssets.find((a) => a.token.toLowerCase() === sleeve.stakeToken.toLowerCase());
    const idx = BigInt(asset?.poolIndex ?? 0);
    const dp = { address: sleeve.depositPool, abi: depositPoolAbi } as const;
    const [user, details, pending] = await Promise.all([
      c.readContract({ ...dp, functionName: 'usersData', args: [account, idx] }),
      c.readContract({ ...dp, functionName: 'rewardPoolsProtocolDetails', args: [idx] }),
      c.readContract({ ...dp, functionName: 'getLatestUserReward', args: [idx, account] }).catch(() => 0n),
    ]);
    const [lastStake, deposited, , , , claimLockEnd, , lastClaim] = user;
    const [, claimAfterStake, claimAfterClaim] = details;
    const claimableAt = [lastStake + claimAfterStake, lastClaim + claimAfterClaim, claimLockEnd].reduce((a, b) => (b > a ? b : a)) + 1n;
    out.push({
      account,
      sleeveId: Number(sleeveId),
      epochId: Number(epochId),
      lockOptionId: Number(lockOptionId),
      symbol: asset?.symbol ?? 'token',
      decimals: asset?.decimals ?? 18,
      inMorpheus,
      deposited,
      pending,
      claimableAt,
      boostedUntil: claimLockEnd,
    });
  }
  return out;
}

/** Triggers Morpheus to mint the account's MOR to the pool's splitter on Arbitrum. Sends the quoted fee + 20%;
 * LayerZero refunds what it does not use to the caller. */
export async function claimMor(net: NetworkConfig, me: Address, vault: Address, a: AccountMor, fee: bigint) {
  return write(
    net.l1,
    me,
    vault,
    A.PoolVault.abi as Abi,
    'claimMor',
    [BigInt(a.sleeveId), BigInt(a.epochId), BigInt(a.lockOptionId)],
    (fee * 12n) / 10n,
  );
}

export async function morBalances(net: NetworkConfig, splitter: Address, partner: Address) {
  const c = publicClient(net.l2);
  const [inSplitter, partnerMor] = await Promise.all([
    c.readContract({ address: net.mor, abi: erc20Abi, functionName: 'balanceOf', args: [splitter] }),
    c.readContract({ address: net.mor, abi: erc20Abi, functionName: 'balanceOf', args: [partner] }),
  ]);
  return { inSplitter, partnerMor };
}

/** Anyone can split the splitter's MOR: DAT fee to the fee wallet, the rest to the Partner. */
export const distributeMor = (net: NetworkConfig, me: Address, splitter: Address) =>
  write(net.l2, me, splitter, A.MorSplitter.abi as Abi, 'distribute', []);

/** Sandbox only: MOR never arrives from LayerZero locally, so this mints stand-in MOR to the splitter. */
export const sandboxSendMor = (net: NetworkConfig, me: Address, splitter: Address, amount: bigint) =>
  write(net.l2, me, net.mor, A.MockERC20.abi as Abi, 'mint', [splitter, amount]);

/** Morpheus's MOR multiplier for locking the MOR claim from `start` to `end` (unix seconds): its
 * LockMultiplierMath curve (tanh, 25 Jul 2024 – 26 Jan 2040, ×1 to ×10.7). It rewards locking the claim, not the stake. */
export function morClaimLockMultiplier(start: number, end: number) {
  const s0 = 1721908800;
  const e0 = 2211192000;
  const d = e0 - s0;
  const a = Math.max(start, s0);
  const b = Math.min(end, e0);
  if (a >= b) return 1;
  const m = 16.61327546 * (Math.tanh((2 * (b - s0)) / d) - Math.tanh((2 * (a - s0)) / d));
  return Math.min(10.7, Math.max(1, m));
}
