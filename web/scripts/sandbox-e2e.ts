// End-to-end on the running sandbox (`npm run sandbox`), impersonating the admin wallet:
// deploy plan → USDT pool → stake USDT → skip a year → withdraw.  npx tsx scripts/sandbox-e2e.ts
import { createPublicClient, createWalletClient, http, parseEventLogs, parseUnits, type Abi, type Address } from 'viem';
import * as A from '../src/contracts/artifacts';
import { NETWORKS } from '../src/config/networks';
import { ADMIN_WALLETS } from '../src/config/admin';
import { DEFAULT_PARAMS, STEPS, type Ctx, type DeployState } from '../src/lib/deployPlan';
import { buildConfig, defaultForm } from '../src/lib/pool';

const net = NETWORKS.local;
const me = ADMIN_WALLETS[0];
const pub = { l1: createPublicClient({ chain: net.l1, transport: http(undefined, { timeout: 180_000 }) }), l2: createPublicClient({ chain: net.l2, transport: http(undefined, { timeout: 180_000 }) }) };
const wal = { l1: createWalletClient({ chain: net.l1, transport: http(undefined, { timeout: 180_000 }), account: me }), l2: createWalletClient({ chain: net.l2, transport: http(undefined, { timeout: 180_000 }), account: me }) };
const rpc = (layer: 'l1' | 'l2', method: string, params: unknown[]) => pub[layer].request({ method: method as never, params: params as never });

async function send(layer: 'l1' | 'l2', address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await pub[layer].simulateContract({ account: me, address, abi, functionName, args } as never);
  const hash = await wal[layer].writeContract(request as never);
  const r = await pub[layer].waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
  return r;
}

async function main() {
  for (const l of ['l1', 'l2'] as const) await rpc(l, 'anvil_impersonateAccount', [me]);

  const state: DeployState = { network: 'local', deployer: me, params: DEFAULT_PARAMS(me), results: {} };
  for (const step of STEPS) {
    const ctx: Ctx = {
      net, deployer: me, params: state.params, results: state.results,
      deploy: async (layer, art, args) => {
        const hash = await wal[layer].deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never);
        const r = await pub[layer].waitForTransactionReceipt({ hash });
        return { address: r.contractAddress!, hash };
      },
      write: async (layer, address, abi, fn, args) => ({ hash: (await send(layer, address, abi, fn, args)).transactionHash }),
    };
    state.results[step.id] = step.skip?.(ctx) ? { skipped: true } : await step.run(ctx);
    console.log('step', step.id, state.results[step.id].address ?? '');
  }
  const factory = state.results.poolFactory.address!;
  const splitterDeployer = state.results.splitterDeployer.address!;
  console.log('deployed factory', factory);

  // Reward token + USDT/USDC pool with a 12-month lock
  const h = await wal.l1.deployContract({ abi: A.MockERC20.abi, bytecode: A.MockERC20.bytecode, args: ['Test EXM', 'tEXM', 18] });
  const tleo = (await pub.l1.waitForTransactionReceipt({ hash: h })).contractAddress!;
  await send('l1', tleo, A.MockERC20.abi as Abi, 'mint', [me, parseUnits('42000000', 18)]);
  const form = defaultForm(net);
  form.rewardToken = tleo;
  form.sleeves.USDC.enabled = true;
  form.sleeves.USDT.enabled = true;
  form.sleeves.USDT.unitAmount = '1000000';
  form.sleeves.USDT.rate = '20000';
  form.sleeves.USDT.cap = '10000000';
  form.sleeves.USDT.minPerWallet = '100';
  form.budget = '5000000';
  const { cfg, errors, budget } = buildConfig(form, net, 18);
  if (errors.length) throw new Error(errors.join('; '));
  await send('l1', tleo, A.MockERC20.abi as Abi, 'approve', [factory, budget]);
  const r = await send('l1', factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: r.logs, eventName: 'PoolCreated' });
  const vault = ev.args.vault;
  const salt = await pub.l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolSalt', args: [vault] });
  await send('l2', splitterDeployer, A.SplitterDeployer.abi as Abi, 'deploySplitter', [salt, me]);
  console.log('pool', vault, 'splitter live', (await pub.l2.getCode({ address: ev.args.morReceiver })) !== undefined);

  // Stake 10,000 USDT for 12 months (sleeve index of USDT in the config)
  const usdt = net.stakeAssets.find((a) => a.symbol === 'USDT')!;
  const sleeveId = BigInt(cfg.sleeves.findIndex((s) => s.stakeToken === usdt.token));
  await rpc('l1', 'evm_increaseTime', [16 * 60]);
  await rpc('l1', 'evm_mine', []);
  await rpc('l1', 'anvil_dealERC20', [me, usdt.token, `0x${parseUnits('10000', 6).toString(16)}`]);
  const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] }] as const;
  await send('l1', usdt.token, approveAbi as Abi, 'approve', [vault, parseUnits('10000', 6)]);
  await send('l1', vault, A.PoolVault.abi as Abi, 'stake', [sleeveId, 0n, parseUnits('10000', 6), 0n]);
  const pos = await pub.l1.readContract({ address: vault, abi: A.PoolVault.abi, functionName: 'position', args: [0n] });
  console.log('staked', pos.amount, 'USDT units, reward', pos.reward);

  // Skip a year and withdraw (no pre-fetch: withdraw pulls the account from Morpheus itself)
  await rpc('l1', 'evm_increaseTime', [366 * 86400]);
  await rpc('l1', 'evm_mine', []);
  await rpc('l1', 'anvil_dealERC20', [vault, usdt.token, '0xa']); // dust reserve
  const before = await pub.l1.readContract({ address: usdt.token, abi: A.MockERC20.abi, functionName: 'balanceOf', args: [me] });
  await send('l1', vault, A.PoolVault.abi as Abi, 'withdraw', [0n]);
  const after = await pub.l1.readContract({ address: usdt.token, abi: A.MockERC20.abi, functionName: 'balanceOf', args: [me] });
  const exampleToken = await pub.l1.readContract({ address: tleo, abi: A.MockERC20.abi, functionName: 'balanceOf', args: [me] });
  console.log('USDT back', after - before, '| tEXM paid', 42_000_000n * 10n ** 18n - budget + 0n === exampleToken ? 0n : exampleToken - (42_000_000n * 10n ** 18n - budget));
}

main().catch((e) => {
  console.error(e.shortMessage ?? e);
  process.exit(1);
});
