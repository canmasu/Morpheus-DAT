import { type Abi, type Address, type Hash, isAddress, keccak256, toBytes, zeroAddress } from 'viem';
import * as A from '@/contracts/artifacts';
import type { NetworkConfig, NetworkName } from '@/config/networks';

export type Layer = 'l1' | 'l2';

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
};

export type Step = {
  id: string;
  layer: Layer;
  group: 'Arbitrum' | 'Ethereum' | 'Configure' | 'Hand over';
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

/** Ordered as in docs/proposal.md "Contract order": Arbitrum first, so Ethereum can predict splitters. */
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
    config: {
      feeBps: state.params.feeBps,
      feeWallet: state.params.feeWallet,
      referralAddress: state.params.referral,
      mor: net.mor,
      stakeAssets: net.stakeAssets,
    },
  };
}
