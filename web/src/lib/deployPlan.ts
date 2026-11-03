import { type Abi, type Address, type Hash, isAddress, keccak256, toBytes, zeroAddress } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig, NetworkName } from '@/config/networks';
import { lzBaseOf, lzEthereumOf } from '@/config/bridge';

export type Layer = 'l1' | 'l2' | 'base';

export type DeployParams = {
  feeWallet: string;
  referral: string;
  feeBps: number;
  guardian: string;
  pauser: string;
  featurer: string;
  /** Safe that takes over every admin role at the end. Empty = deployer stays admin. */
  finalAdmin: string;
};

export type StepResult = { address?: Address; hash?: Hash; skipped?: boolean };

export type DeployState = {
  network: NetworkName;
  deployer?: Address;
  params: DeployParams;
  results: Record<string, StepResult>;
  updatedAt?: string;
};

export type Ctx = {
  net: NetworkConfig;
  deployer: Address;
  params: DeployParams;
  results: Record<string, StepResult>;
  deploy: (layer: Layer, artifact: { abi: Abi; bytecode: `0x${string}` }, args: unknown[]) => Promise<StepResult>;
  write: (layer: Layer, address: Address, abi: Abi, functionName: string, args: unknown[]) => Promise<StepResult>;
  read: (layer: Layer, address: Address, abi: Abi, functionName: string, args: unknown[]) => Promise<unknown>;
};

export type Step = {
  id: string;
  layer: Layer;
  group: 'Arbitrum' | 'Ethereum' | 'Configure' | 'Hand over' | 'Base (MOR pools)';
  title: string;
  detail: string;
  skip?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => Promise<StepResult>;
};

export const role = (name: string) => keccak256(toBytes(name));
export const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hash;

const addr = (ctx: Ctx, id: string) => {
  const a = ctx.results[id]?.address;
  if (!a) throw new Error(`Step "${id}" has no address yet`);
  return a;
};

const opt = (s: string) => (s && isAddress(s) ? (s as Address) : undefined);

const handoverTarget = (ctx: Ctx) => {
  const t = opt(ctx.params.finalAdmin);
  return t && t.toLowerCase() !== ctx.deployer.toLowerCase() ? t : undefined;
};

export const DEFAULT_PARAMS = (deployer?: string): DeployParams => ({
  feeWallet: deployer ?? '',
  referral: deployer ?? '',
  feeBps: 1000,
  guardian: deployer ?? '',
  pauser: deployer ?? '',
  featurer: deployer ?? '',
  finalAdmin: '',
});

export function validateParams(p: DeployParams): string[] {
  const errs: string[] = [];
  if (!isAddress(p.feeWallet)) errs.push('Fee wallet must be an address');
  if (p.referral && !isAddress(p.referral)) errs.push('Referral address is not valid');
  if (!Number.isInteger(p.feeBps) || p.feeBps < 0 || p.feeBps > 2000) errs.push('Fee must be 0 to 2000 bps (20% cap)');
  for (const [k, v] of [['Guardian', p.guardian], ['Pauser', p.pauser], ['Featurer', p.featurer], ['Final admin', p.finalAdmin]]) {
    if (v && !isAddress(v)) errs.push(`${k} is not a valid address`);
  }
  return errs;
}

const noBuilders = (c: Ctx) => !c.net.builders;

/** MOR pools. The same splitter contracts as Arbitrum, but on Base beside the pools, so no bridge is involved. */
function BASE_STEPS(): Step[] {
  const step = (id: string, title: string, detail: string, run: Step['run']): Step => ({
    id,
    layer: 'base',
    group: 'Base (MOR pools)',
    title,
    detail,
    skip: noBuilders,
    run,
  });
  const builders = (c: Ctx) => (c.net.builders!.simulated ? { contract: addr(c, 'simBuilders'), mor: addr(c, 'simMor') } : c.net.builders!);
  const sim = (id: string, title: string, detail: string, run: Step['run']): Step => ({
    ...step(id, title, detail, run),
    skip: (c) => !c.net.builders?.simulated,
  });
  // Solidity leaves a placeholder where a public library's address goes.
  const linked = (bytecode: `0x${string}`, library: Address) => bytecode.replace(/__\$[0-9a-f]{34}\$__/g, library.slice(2).toLowerCase()) as `0x${string}`;
  const fromSetup = (c: Ctx, getter: string) =>
    c.read('base', addr(c, 'simSetup'), A.SimSetup.abi as Abi, getter, []).then((address) => ({ address: address as Address }));
  return [
    sim('simMor', 'Test MOR', 'simulation: open-mint MOR for testers', (c) => c.deploy('base', A.MockERC20, ['Test MOR (simulation)', 'MOR', 18])),
    sim('simLib', 'Morpheus reward library', 'simulation: Morpheus code, unchanged', (c) => c.deploy('base', A.LinearDistributionIntervalDecrease, [])),
    sim('simRewardPoolImpl', 'Morpheus RewardPool', 'simulation: Morpheus code, unchanged', (c) =>
      c.deploy('base', { abi: A.RewardPool.abi as Abi, bytecode: linked(A.RewardPool.bytecode, addr(c, 'simLib')) }, []),
    ),
    sim('simFeeConfigImpl', 'Morpheus FeeConfig', 'simulation: Morpheus code, unchanged', (c) => c.deploy('base', A.FeeConfig, [])),
    sim('simTreasuryImpl', 'Morpheus BuildersTreasuryV2', 'simulation: Morpheus code, unchanged', (c) => c.deploy('base', A.BuildersTreasuryV2, [])),
    sim('simBuildersImpl', 'Morpheus BuildersV4', 'simulation: Morpheus code, unchanged', (c) => c.deploy('base', A.BuildersV4, [])),
    sim('simSetup', 'Set up the simulation', "mainnet's settings, a funded treasury and a stand-in for other subnets' stake", (c) =>
      c.deploy('base', A.SimSetup, [
        c.deployer,
        addr(c, 'simMor'),
        addr(c, 'simRewardPoolImpl'),
        addr(c, 'simFeeConfigImpl'),
        addr(c, 'simTreasuryImpl'),
        addr(c, 'simBuildersImpl'),
      ]),
    ),
    sim('simBuilders', 'BuildersV4 (simulated)', 'reads its address, no transaction', (c) => fromSetup(c, 'builders')),
    sim('simTreasury', 'Builders treasury (simulated)', 'reads its address, no transaction', (c) => fromSetup(c, 'treasury')),
    step('baseFeeConfig', 'ArbFeeConfig', 'DAT fee on MOR from Base pools', (c) =>
      c.deploy('base', A.ArbFeeConfig, [c.deployer, builders(c).mor, c.params.feeBps, c.params.feeWallet]),
    ),
    step('baseSplitterImpl', 'MorSplitter implementation', 'cloned once per pool', (c) => c.deploy('base', A.MorSplitter, [])),
    step('baseSplitterDeployer', 'SplitterDeployer', 'CREATE2 factory for pool splitters', (c) =>
      c.deploy('base', A.SplitterDeployer, [addr(c, 'baseSplitterImpl'), addr(c, 'baseFeeConfig')]),
    ),
    step('baseAdapter', 'BuildersAdapter', 'records the Builders baseline (circuit breaker)', (c) =>
      c.deploy('base', A.BuildersAdapter, [c.deployer, [builders(c).contract]]),
    ),
    step('baseExitAdapter', 'BuildersExitAdapter', 'instant withdraw-only fallback', (c) =>
      c.deploy('base', A.BuildersExitAdapter, [c.deployer, [builders(c).contract]]),
    ),
    step('baseAccountImpl', 'CapitalAccount implementation', 'one clone per epoch × lock', (c) => c.deploy('base', A.CapitalAccount, [])),
    step('baseVaultImpl', 'BuilderVault implementation', 'one clone per pool', (c) => c.deploy('base', A.BuilderVault, [])),
    step('baseFactory', 'BuilderPoolFactory', 'creates a pool and its Builders subnet', (c) =>
      c.deploy('base', A.BuilderPoolFactory, [
        {
          admin: c.deployer,
          poolVaultImpl: addr(c, 'baseVaultImpl'),
          capitalAccountImpl: addr(c, 'baseAccountImpl'),
          adapter: addr(c, 'baseAdapter'),
          exitAdapter: addr(c, 'baseExitAdapter'),
          splitterDeployer: addr(c, 'baseSplitterDeployer'),
          splitterImpl: addr(c, 'baseSplitterImpl'),
          feeWallet: c.params.feeWallet,
          referralAddress: zeroAddress,
          feeBps: c.params.feeBps,
          stakeTokens: [builders(c).mor],
          depositPools: [builders(c).contract],
        },
      ]),
    ),
    {
      ...step('ethBridgeRegistry', 'OGBridgeRegistry on Ethereum', 'lets Partners also fund stETH and stablecoin pools; no admin, holds nothing', (c) =>
        c.deploy('l1', A.OGBridgeRegistry, [lzEthereumOf(c.net).endpoint]),
      ),
      layer: 'l1',
    },
    step('bridgeRegistry', 'OGBridgeRegistry', 'lets Partners bring a token to Base; no admin, holds nothing', (c) =>
      c.deploy('base', A.OGBridgeRegistry, [lzBaseOf(c.net).endpoint]),
    ),
    ...(['GUARDIAN_ROLE', 'PAUSER_ROLE', 'FEATURER_ROLE'] as const).map((r): Step => {
      const holder = (c: Ctx) => (r === 'GUARDIAN_ROLE' ? c.params.guardian : r === 'PAUSER_ROLE' ? c.params.pauser : c.params.featurer);
      return {
        ...step(`base_grant_${r}`, `Grant ${r.replace('_ROLE', '').toLowerCase()} role`, 'on BuilderPoolFactory', (c) =>
          c.write('base', addr(c, 'baseFactory'), A.BuilderPoolFactory.abi as Abi, 'grantRole', [role(r), holder(c)]),
        ),
        skip: (c) => noBuilders(c) || !opt(holder(c)),
      };
    }),
    ...(
      [
        ['baseAdapter', A.BuildersAdapter.abi],
        ['baseExitAdapter', A.BuildersExitAdapter.abi],
        ['baseFeeConfig', A.ArbFeeConfig.abi],
      ] as const
    ).map(([id, abi]): Step => ({
      ...step(`base_handover_${id}`, `Offer ${id} ownership to the Safe`, 'Ownable2Step: the Safe must call acceptOwnership()', (c) =>
        c.write('base', addr(c, id), abi as Abi, 'transferOwnership', [handoverTarget(c)]),
      ),
      skip: (c) => noBuilders(c) || !handoverTarget(c),
    })),
    {
      ...step('base_handover_factory', 'Grant factory admin to the Safe', 'DEFAULT_ADMIN_ROLE → final admin', (c) =>
        c.write('base', addr(c, 'baseFactory'), A.BuilderPoolFactory.abi as Abi, 'grantRole', [DEFAULT_ADMIN_ROLE, handoverTarget(c)]),
      ),
      skip: (c) => noBuilders(c) || !handoverTarget(c),
    },
    {
      ...step('base_handover_renounce', 'Deployer renounces factory admin', 'last Base step: only the Safe stays admin', (c) =>
        c.write('base', addr(c, 'baseFactory'), A.BuilderPoolFactory.abi as Abi, 'renounceRole', [DEFAULT_ADMIN_ROLE, c.deployer]),
      ),
      skip: (c) => noBuilders(c) || !handoverTarget(c),
    },
  ];
}

/** Arbitrum first, so Ethereum can predict splitters. */
export const STEPS: Step[] = [
  {
    id: 'arbFeeConfig',
    layer: 'l2',
    group: 'Arbitrum',
    title: 'ArbFeeConfig',
    detail: 'DAT fee, fee wallet, 20% cap, 48h timelock',
    run: (c) => c.deploy('l2', A.ArbFeeConfig, [c.deployer, c.net.mor, c.params.feeBps, c.params.feeWallet]),
  },
  {
    id: 'morSplitterImpl',
    layer: 'l2',
    group: 'Arbitrum',
    title: 'MorSplitter implementation',
    detail: 'cloned once per pool',
    run: (c) => c.deploy('l2', A.MorSplitter, []),
  },
  {
    id: 'splitterDeployer',
    layer: 'l2',
    group: 'Arbitrum',
    title: 'SplitterDeployer',
    detail: 'CREATE2 factory for pool splitters',
    run: (c) => c.deploy('l2', A.SplitterDeployer, [addr(c, 'morSplitterImpl'), addr(c, 'arbFeeConfig')]),
  },
  {
    id: 'adapter',
    layer: 'l1',
    group: 'Ethereum',
    title: 'MorpheusAdapter',
    detail: 'records the Morpheus baseline (circuit breaker)',
    run: (c) =>
      c.deploy('l1', A.MorpheusAdapter, [
        c.deployer,
        c.net.stakeAssets.map((s) => s.depositPool),
        c.net.stakeAssets.map((s) => BigInt(s.poolIndex)),
      ]),
  },
  {
    id: 'exitAdapter',
    layer: 'l1',
    group: 'Ethereum',
    title: 'ExitOnlyAdapter',
    detail: 'instant withdraw-only fallback',
    run: (c) =>
      c.deploy('l1', A.ExitOnlyAdapter, [
        c.deployer,
        c.net.stakeAssets.map((s) => s.depositPool),
        c.net.stakeAssets.map((s) => BigInt(s.poolIndex)),
      ]),
  },
  {
    id: 'capitalAccountImpl',
    layer: 'l1',
    group: 'Ethereum',
    title: 'CapitalAccount implementation',
    detail: 'one clone per sleeve × epoch × lock',
    run: (c) => c.deploy('l1', A.CapitalAccount, []),
  },
  {
    id: 'poolVaultImpl',
    layer: 'l1',
    group: 'Ethereum',
    title: 'PoolVault implementation',
    detail: 'one clone per pool',
    run: (c) => c.deploy('l1', A.PoolVault, []),
  },
  {
    id: 'poolFactory',
    layer: 'l1',
    group: 'Ethereum',
    title: 'PoolFactory',
    detail: 'implementations, adapters, splitter prediction, fee, referral, stake assets',
    run: (c) =>
      c.deploy('l1', A.PoolFactory, [
        {
          admin: c.deployer,
          poolVaultImpl: addr(c, 'poolVaultImpl'),
          capitalAccountImpl: addr(c, 'capitalAccountImpl'),
          adapter: addr(c, 'adapter'),
          exitAdapter: addr(c, 'exitAdapter'),
          splitterDeployer: addr(c, 'splitterDeployer'),
          splitterImpl: addr(c, 'morSplitterImpl'),
          feeWallet: c.params.feeWallet,
          referralAddress: opt(c.params.referral) ?? zeroAddress,
          feeBps: c.params.feeBps,
          stakeTokens: c.net.stakeAssets.map((s) => s.token),
          depositPools: c.net.stakeAssets.map((s) => s.depositPool),
        },
      ]),
  },
  {
    id: 'otcMarket',
    layer: 'l1',
    group: 'Ethereum',
    title: 'OTCMarket',
    detail: 'fixed-price escrow listings, no admin',
    run: (c) => c.deploy('l1', A.OTCMarket, []),
  },
  ...BASE_STEPS(),
  ...(['GUARDIAN_ROLE', 'PAUSER_ROLE', 'FEATURER_ROLE'] as const).map(
    (r): Step => ({
      id: `grant_${r}`,
      layer: 'l1',
      group: 'Configure',
      title: `Grant ${r.replace('_ROLE', '').toLowerCase()} role`,
      detail: r === 'GUARDIAN_ROLE' ? 'pause everything, emergency exit, exit-only adapter' : r === 'PAUSER_ROLE' ? 'pause deposits' : 'featured flags',
      skip: (c) => !opt(r === 'GUARDIAN_ROLE' ? c.params.guardian : r === 'PAUSER_ROLE' ? c.params.pauser : c.params.featurer),
      run: (c) =>
        c.write('l1', addr(c, 'poolFactory'), A.PoolFactory.abi as Abi, 'grantRole', [
          role(r),
          r === 'GUARDIAN_ROLE' ? c.params.guardian : r === 'PAUSER_ROLE' ? c.params.pauser : c.params.featurer,
        ]),
    }),
  ),
  {
    id: 'handover_factory',
    layer: 'l1',
    group: 'Hand over',
    title: 'Grant factory admin to the Safe',
    detail: 'DEFAULT_ADMIN_ROLE → final admin',
    skip: (c) => !handoverTarget(c),
    run: (c) => c.write('l1', addr(c, 'poolFactory'), A.PoolFactory.abi as Abi, 'grantRole', [DEFAULT_ADMIN_ROLE, handoverTarget(c)]),
  },
  ...(
    [
      ['adapter', 'l1', A.MorpheusAdapter.abi],
      ['exitAdapter', 'l1', A.ExitOnlyAdapter.abi],
      ['arbFeeConfig', 'l2', A.ArbFeeConfig.abi],
    ] as const
  ).map(
    ([id, layer, abi]): Step => ({
      id: `handover_${id}`,
      layer,
      group: 'Hand over',
      title: `Offer ${id} ownership to the Safe`,
      detail: 'Ownable2Step: the Safe must call acceptOwnership()',
      skip: (c) => !handoverTarget(c),
      run: (c) => c.write(layer, addr(c, id), abi as Abi, 'transferOwnership', [handoverTarget(c)]),
    }),
  ),
  {
    id: 'handover_renounce',
    layer: 'l1',
    group: 'Hand over',
    title: 'Deployer renounces factory admin',
    detail: 'last step: only the Safe stays admin',
    skip: (c) => !handoverTarget(c),
    run: (c) => c.write('l1', addr(c, 'poolFactory'), A.PoolFactory.abi as Abi, 'renounceRole', [DEFAULT_ADMIN_ROLE, c.deployer]),
  },
];

/** deployments/<network>.json shape, read by the website, indexer and /contracts. */
export function toDeploymentsJson(state: DeployState, net: NetworkConfig) {
  const pick = (layer: Layer) =>
    Object.fromEntries(
      STEPS.filter((s) => s.layer === layer && state.results[s.id]?.address).map((s) => [s.id, state.results[s.id].address]),
    );
  return {
    network: net.name,
    deployer: state.deployer,
    updatedAt: state.updatedAt,
    ethereum: { chainId: net.l1.id, ...pick('l1') },
    arbitrum: { chainId: net.l2.id, ...pick('l2') },
    ...(net.builders ? { base: { chainId: net.builders.chain.id, ...pick('base') } } : {}),
    config: {
      feeBps: state.params.feeBps,
      feeWallet: state.params.feeWallet,
      referralAddress: state.params.referral,
      mor: net.mor,
      stakeAssets: net.stakeAssets,
    },
  };
}
