import { type Abi, type Address, type Hash, erc20Abi, parseAbi, parseEventLogs, parseUnits, zeroAddress } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig } from '@/config/networks';
import { deploymentsOf } from './deployments';
import { deploy, ensureAllowance, publicClient, write } from './tx';
import type { PoolConfig } from './pool';

const buildersAbi = parseAbi([
  'function subnetCreationFeeAmount() view returns (uint256)',
  'function getSubnetId(string) view returns (bytes32)',
  'function subnets(bytes32) view returns (string, address, uint128, uint128, uint128, uint256, address)',
  'function subnetsData(bytes32) view returns (uint128, uint256, uint256, uint256, uint256)',
]);

export function contractsFor(net: NetworkConfig) {
  const d = deploymentsOf(net.name);
  if (net.isBase) return { factory: d.base?.baseFactory, splitterDeployer: d.base?.baseSplitterDeployer };
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

/** Testnet only: a mintable test token named by the tester, with `supply` minted to the Partner. */
export async function createTestToken(net: NetworkConfig, partner: Address, name: string, symbol: string, supply: string) {
  const { address } = await deploy(net.l1, partner, A.MockERC20, [name, symbol, 18], `Deploy ${symbol}`);
  await write(net.l1, partner, address, A.MockERC20.abi as Abi, 'mint', [partner, parseUnits(supply.replace(/[,_\s]/g, ''), 18)]);
  return address;
}

export async function approveIfNeeded(net: NetworkConfig, partner: Address, token: Address, spender: Address, amount: bigint) {
  await ensureAllowance(net.l1, partner, token, spender, amount);
}

export async function createPool(net: NetworkConfig, partner: Address, factory: Address, cfg: PoolConfig, budget: bigint) {
  const { receipt } = await write(net.l1, partner, factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: receipt.logs, eventName: 'PoolCreated' });
  if (!ev) throw new Error('PoolCreated event not found');
  return { vault: ev.args.vault, morReceiver: ev.args.morReceiver };
}

export type SubnetMetadata = { slug: string; description: string; website: string; image: string };

/** Morpheus's Subnet creation fee (in MOR), paid by the Partner when creating a Base pool. */
export const subnetCreationFee = (net: NetworkConfig) =>
  publicClient(net.l1).readContract({ address: net.builders!.contract, abi: buildersAbi, functionName: 'subnetCreationFeeAmount' });

export async function subnetNameTaken(net: NetworkConfig, name: string) {
  const c = publicClient(net.l1);
  const { contract } = net.builders!;
  const id = await c.readContract({ address: contract, abi: buildersAbi, functionName: 'getSubnetId', args: [name] });
  const [, admin] = await c.readContract({ address: contract, abi: buildersAbi, functionName: 'subnets', args: [id] });
  return admin !== zeroAddress;
}

/** A pool on Base and, in the same transaction, its own Builders Subnet. */
export async function createBuilderPool(
  net: NetworkConfig,
  partner: Address,
  factory: Address,
  cfg: PoolConfig,
  budget: bigint,
  subnetName: string,
  metadata: SubnetMetadata,
) {
  const { receipt } = await write(net.l1, partner, factory, A.BuilderPoolFactory.abi as Abi, 'createBuilderPool', [cfg, budget, subnetName, metadata]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: receipt.logs, eventName: 'PoolCreated' });
  if (!ev) throw new Error('PoolCreated event not found');
  return { vault: ev.args.vault, morReceiver: ev.args.morReceiver };
}

export type SubnetStatus = { id: Hash; name: string; pending: bigint; deposited: bigint };

export async function subnetStatus(net: NetworkConfig, vault: Address): Promise<SubnetStatus> {
  const c = publicClient(net.l1);
  const v = { address: vault, abi: A.BuilderVault.abi } as const;
  const [id, pending] = await Promise.all([
    c.readContract({ ...v, functionName: 'subnetId' }),
    c.readContract({ ...v, functionName: 'pendingSubnetMor' }),
  ]);
  const b = { address: net.builders!.contract, abi: buildersAbi } as const;
  const [[name], [, deposited]] = await Promise.all([
    c.readContract({ ...b, functionName: 'subnets', args: [id] }),
    c.readContract({ ...b, functionName: 'subnetsData', args: [id] }),
  ]);
  return { id, name, pending, deposited };
}

export const claimSubnetMor = (net: NetworkConfig, me: Address, vault: Address) =>
  write(net.l1, me, vault, A.BuilderVault.abi as Abi, 'claimSubnetMor', []);

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
