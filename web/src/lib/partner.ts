import { type Abi, type Address, erc20Abi, parseEventLogs, parseUnits } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig } from '@/config/networks';
import { deploymentsOf } from './deployments';
import { deploy, publicClient, write } from './tx';
import type { PoolConfig } from './pool';

export function contractsFor(net: NetworkConfig) {
  const d = deploymentsOf(net.name);
  return { factory: d.ethereum?.poolFactory, splitterDeployer: d.arbitrum?.splitterDeployer };
}

export async function tokenInfo(net: NetworkConfig, token: Address, owner?: Address, spender?: Address) {
  const c = publicClient(net.l1);
  const [symbol, decimals, balance, allowance] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    c.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    owner ? c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) : 0n,
    owner && spender ? c.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] }) : 0n,
  ]);
  return { symbol, decimals, balance, allowance };
}

/** Testnet only: a mintable "Test EXM" with 42,000,000 minted to the Partner. */
export async function createTestToken(net: NetworkConfig, partner: Address) {
  const { address } = await deploy(net.l1, partner, A.MockERC20, ['Test EXM', 'tEXM', 18]);
  await write(net.l1, partner, address, A.MockERC20.abi as Abi, 'mint', [partner, parseUnits('42000000', 18)]);
  return address;
}

export async function approveIfNeeded(net: NetworkConfig, partner: Address, token: Address, spender: Address, amount: bigint) {
  const allowance = await publicClient(net.l1).readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [partner, spender] });
  if (allowance >= amount) return;
  await write(net.l1, partner, token, erc20Abi as Abi, 'approve', [spender, amount]);
}

export async function createPool(net: NetworkConfig, partner: Address, factory: Address, cfg: PoolConfig, budget: bigint) {
  const { receipt } = await write(net.l1, partner, factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: receipt.logs, eventName: 'PoolCreated' });
  if (!ev) throw new Error('PoolCreated event not found');
  return { vault: ev.args.vault, morReceiver: ev.args.morReceiver };
}

export async function splitterDeployed(net: NetworkConfig, morReceiver: Address) {
  const code = await publicClient(net.l2).getCode({ address: morReceiver });
  return !!code && code !== '0x';
}

/** Flow B, Arbitrum half: deploys the pool's MOR splitter at the address the vault already points to. */
export async function deploySplitter(net: NetworkConfig, partner: Address, factory: Address, splitterDeployer: Address, vault: Address) {
  const l1 = publicClient(net.l1);
  const [salt, morReceiver] = await Promise.all([
    l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolSalt', args: [vault] }),
    l1.readContract({ address: vault, abi: A.PoolVault.abi, functionName: 'morReceiver' }),
  ]);
  const predicted = await publicClient(net.l2).readContract({
    address: splitterDeployer,
    abi: A.SplitterDeployer.abi,
    functionName: 'predict',
    args: [salt, partner],
  });
  if (predicted.toLowerCase() !== morReceiver.toLowerCase()) {
    throw new Error('Splitter address mismatch: connect the wallet that created this pool');
  }
  if (!(await splitterDeployed(net, morReceiver))) {
    await write(net.l2, partner, splitterDeployer, A.SplitterDeployer.abi as Abi, 'deploySplitter', [salt, partner]);
  }
  return morReceiver;
}

export type PoolSummary = {
  vault: Address;
  partner: Address;
  rewardToken: Address;
  rewardSymbol: string;
  rewardDecimals: number;
  available: bigint;
  committed: bigint;
  depositStart: bigint;
  depositEnd: bigint;
  morReceiver: Address;
  splitterLive: boolean;
  featured: boolean;
  positions: bigint;
};

export async function listPools(net: NetworkConfig, factory: Address, onlyPartner?: Address): Promise<PoolSummary[]> {
  const c = publicClient(net.l1);
  const count = await c.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolCount' });
  if (count === 0n) return [];
  const vaults = await c.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'getPools', args: [0n, count] });
  const out: PoolSummary[] = [];
  for (const vault of [...vaults].reverse()) {
    const v = { address: vault, abi: A.PoolVault.abi } as const;
    const partner = await c.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolPartner', args: [vault] });
    if (onlyPartner && partner.toLowerCase() !== onlyPartner.toLowerCase()) continue;
    const [rewardToken, available, committed, depositStart, depositEnd, morReceiver, positions, featured] = await Promise.all([
      c.readContract({ ...v, functionName: 'rewardToken' }),
      c.readContract({ ...v, functionName: 'available' }),
      c.readContract({ ...v, functionName: 'committed' }),
      c.readContract({ ...v, functionName: 'depositStart' }),
      c.readContract({ ...v, functionName: 'depositEnd' }),
      c.readContract({ ...v, functionName: 'morReceiver' }),
      c.readContract({ ...v, functionName: 'positionCount' }),
      c.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'featured', args: [vault] }),
    ]);
    const [rewardSymbol, rewardDecimals, splitterLive] = await Promise.all([
      c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
      c.readContract({ address: rewardToken, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
      splitterDeployed(net, morReceiver),
    ]);
    out.push({
      vault,
      partner,
      rewardToken,
      rewardSymbol,
      rewardDecimals,
      available,
      committed,
      depositStart,
      depositEnd,
      morReceiver,
      splitterLive,
      featured,
      positions,
    });
  }
  return out;
}
