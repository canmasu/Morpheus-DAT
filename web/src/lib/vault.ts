import { type Abi, type Address, erc20Abi, parseUnits } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig, StakeAsset } from '@/config/networks';
import { ensureAllowance, publicClient, write } from './tx';
import { contractsFor } from './partner';

export type Tier = {
  kind: number; // 0 RANGE, 1 FIXED
  minPerWallet: bigint;
  maxPerWallet: bigint;
  amounts: readonly bigint[];
  multBps: readonly number[];
  lockOptionId: number;
};
export type Sleeve = {
  id: number;
  asset: StakeAsset;
  depositPool: Address;
  unit: bigint;
  ratePerUnit: bigint;
  cap: bigint;
  totalStaked: bigint;
  tiers: Tier[];
  healthy: boolean;
};
export type PoolDetail = {
  vault: Address;
  partner: Address;
  featured: boolean;
  reward: { token: Address; symbol: string; decimals: number };
  sleeves: Sleeve[];
  locks: { id: number; duration: bigint; multBps: number }[];
  depositStart: bigint;
  depositEnd: bigint;
  available: bigint;
  paused: { deposits: boolean; all: boolean };
  morBoost: boolean;
};

export async function readPool(net: NetworkConfig, vault: Address): Promise<PoolDetail> {
  const c = publicClient(net.l1);
  const { factory } = contractsFor(net);
  if (!factory) throw new Error('Not deployed on this network');
  const v = { address: vault, abi: A.PoolVault.abi } as const;
  const f = { address: factory, abi: A.PoolFactory.abi } as const;

  const isPool = await c.readContract({ ...f, functionName: 'isPool', args: [vault] });
  if (!isPool) throw new Error('This address is not a Morpheus DAT pool');

  const [rewardToken, sleeveCount, lockCount, depositStart, depositEnd, available, morBoost, partner, featured, depositsPaused, allPaused, adapter] =
    await Promise.all([
      c.readContract({ ...v, functionName: 'rewardToken' }),
      c.readContract({ ...v, functionName: 'sleeveCount' }),
      c.readContract({ ...v, functionName: 'lockOptionCount' }),
      c.readContract({ ...v, functionName: 'depositStart' }),
      c.readContract({ ...v, functionName: 'depositEnd' }),
      c.readContract({ ...v, functionName: 'available' }),
      c.readContract({ ...v, functionName: 'morBoost' }),
      c.readContract({ ...v, functionName: 'partner' }),
      c.readContract({ ...f, functionName: 'featured', args: [vault] }),
      c.readContract({ ...f, functionName: 'depositsPaused' }),
      c.readContract({ ...f, functionName: 'allPaused' }),
      c.readContract({ ...f, functionName: 'adapter' }),
    ]);
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'symbol' }),
    c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'decimals' }),
  ]);

  const locks = await Promise.all(
    Array.from({ length: Number(lockCount) }, async (_, id) => {
      const l = await c.readContract({ ...v, functionName: 'lockOption', args: [BigInt(id)] });
      return { id, duration: BigInt(l.duration), multBps: Number(l.multBps) };
    }),
  );

  const sleeves = await Promise.all(
    Array.from({ length: Number(sleeveCount) }, async (_, id) => {
      const s = await c.readContract({ ...v, functionName: 'sleeve', args: [BigInt(id)] });
      const tierCount = await c.readContract({ ...v, functionName: 'tierCount', args: [BigInt(id)] });
      const tiers = await Promise.all(
        Array.from({ length: Number(tierCount) }, (_, t) => c.readContract({ ...v, functionName: 'tier', args: [BigInt(id), BigInt(t)] })),
      );
      const healthy = await c.readContract({ address: adapter, abi: A.MorpheusAdapter.abi, functionName: 'isHealthy', args: [s.depositPool] });
      const asset = net.stakeAssets.find((a) => a.token.toLowerCase() === s.stakeToken.toLowerCase()) ?? {
        symbol: 'token',
        token: s.stakeToken,
        decimals: 18,
        depositPool: s.depositPool,
        poolIndex: 0,
      };
      return {
        id,
        asset,
        depositPool: s.depositPool,
        unit: s.unit,
        ratePerUnit: s.ratePerUnit,
        cap: s.cap,
        totalStaked: s.totalStaked,
        healthy,
        tiers: tiers.map((t) => ({
          kind: Number(t.kind),
          minPerWallet: t.minPerWallet,
          maxPerWallet: t.maxPerWallet,
          amounts: t.amounts,
          multBps: t.multBps.map(Number),
          lockOptionId: Number(t.lockOptionId),
        })),
      } satisfies Sleeve;
    }),
  );

  return {
    vault,
    partner,
    featured,
    reward: { token: rewardToken, symbol, decimals },
    sleeves,
    locks,
    depositStart,
    depositEnd,
    available,
    paused: { deposits: depositsPaused, all: allPaused },
    morBoost,
  };
}

export async function allPools(net: NetworkConfig): Promise<{ vault: Address; featured: boolean }[]> {
  const { factory } = contractsFor(net);
  if (!factory) return [];
  const c = publicClient(net.l1);
  const f = { address: factory, abi: A.PoolFactory.abi } as const;
  const count = await c.readContract({ ...f, functionName: 'poolCount' });
  if (count === 0n) return [];
  const vaults = await c.readContract({ ...f, functionName: 'getPools', args: [0n, count] });
  const featured = await Promise.all(vaults.map((p) => c.readContract({ ...f, functionName: 'featured', args: [p] })));
  return vaults.map((vault, i) => ({ vault, featured: featured[i] })).reverse();
}

export async function stake(
  net: NetworkConfig,
  me: Address,
  vault: Address,
  sleeve: Sleeve,
  tierId: number,
  amountOrIndex: bigint,
  amount: bigint,
  lockId: number,
) {
  await ensureAllowance(net.l1, me, sleeve.asset.token, vault, amount);
  return write(net.l1, me, vault, A.PoolVault.abi as Abi, 'stake', [BigInt(sleeve.id), BigInt(tierId), amountOrIndex, BigInt(lockId)]);
}

/** Testnet faucets: stETHMock lets anyone mint; LINK comes from Aave's Sepolia faucet. */
export async function mintTestToken(net: NetworkConfig, me: Address, asset: StakeAsset, amount: string) {
  const units = parseUnits(amount, asset.decimals);
  if (asset.faucet === 'open') return write(net.l1, me, asset.token, A.MockERC20.abi as Abi, 'mint', [me, units]);
  if (!asset.faucet) throw new Error(`No faucet for ${asset.symbol}`);
  const aaveFaucet = [
    {
      type: 'function',
      name: 'mint',
      stateMutability: 'nonpayable',
      inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      outputs: [{ type: 'uint256' }],
    },
  ] as const;
  return write(net.l1, me, asset.faucet, aaveFaucet as Abi, 'mint', [asset.token, me, units]);
}

export type MyPosition = {
  vault: Address;
  id: bigint;
  rewardToken: Address;
  rewardSymbol: string;
  rewardDecimals: number;
  asset: StakeAsset;
  amount: bigint;
  reward: bigint;
  claimed: bigint;
  accrued: bigint;
  start: bigint;
  end: bigint;
  status: number; // 0 Active, 1 ExitPending, 2 Withdrawn
  account: Address;
  emergency: boolean;
};

export async function myPositions(net: NetworkConfig, me: Address): Promise<MyPosition[]> {
  const c = publicClient(net.l1);
  const out: MyPosition[] = [];
  for (const { vault } of await allPools(net)) {
    const v = { address: vault, abi: A.PoolVault.abi } as const;
    const ids = await c.readContract({ ...v, functionName: 'positionsByOwner', args: [me] });
    if (ids.length === 0) continue;
    const rewardToken = await c.readContract({ ...v, functionName: 'rewardToken' });
    const [rewardSymbol, rewardDecimals] = await Promise.all([
      c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'symbol' }),
      c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'decimals' }),
    ]);
    for (const id of ids) {
      const [p, accrued] = await Promise.all([
        c.readContract({ ...v, functionName: 'position', args: [id] }),
        c.readContract({ ...v, functionName: 'accrued', args: [id] }),
      ]);
      const s = await c.readContract({ ...v, functionName: 'sleeve', args: [BigInt(p.sleeveId)] });
      const info = await c.readContract({ ...v, functionName: 'accountInfo', args: [p.account] });
      const asset = net.stakeAssets.find((a) => a.token.toLowerCase() === s.stakeToken.toLowerCase())!;
      out.push({
        vault,
        id,
        rewardToken,
        rewardSymbol,
        rewardDecimals,
        asset,
        amount: p.amount,
        reward: p.reward,
        claimed: p.claimed,
        accrued,
        start: BigInt(p.start),
        end: BigInt(p.end),
        status: Number(p.status),
        account: p.account,
        emergency: info[2],
      });
    }
  }
  return out;
}

export const vaultWrite = (net: NetworkConfig, me: Address, vault: Address, fn: string, args: unknown[]) =>
  write(net.l1, me, vault, A.PoolVault.abi as Abi, fn, args);

/** Readable amount for reward examples: the Omega (range tier) minimum if set, else the rate unit. */
export function refAmount(s: Sleeve) {
  const range = s.tiers.find((t) => t.kind === 0 && t.minPerWallet > 0n);
  return range ? range.minPerWallet : s.unit;
}
