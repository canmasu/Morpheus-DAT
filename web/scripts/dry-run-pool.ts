// Dry-runs the Partner create-pool flow (Flow B) plus one contributor stake against anvil forks of the
// live testnet deployment. Start the forks as in README.md, then: npx tsx scripts/dry-run-pool.ts
import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, parseUnits, type Abi, type Address } from 'viem';
import * as A from '../src/contracts/artifacts';
import { NETWORKS } from '../src/config/networks';
import { ADMIN_WALLETS } from '../src/config/admin';
import { buildConfig, defaultForm } from '../src/lib/pool';
import testnet from '../src/deployments/testnet.json';

const net = NETWORKS.testnet;
const me = ADMIN_WALLETS[0];
let factory = testnet.ethereum.poolFactory as Address;
const splitterDeployer = testnet.arbitrum.splitterDeployer as Address;
const l1 = createPublicClient({ chain: net.l1, transport: http('http://127.0.0.1:8545') });
// Arbitrum: read-only against the live chain (public Arbitrum Sepolia forks often lack the state anvil needs).
const l2 = createPublicClient({ chain: net.l2, transport: http('https://arbitrum-sepolia-rpc.publicnode.com') });
const w1 = createWalletClient({ chain: net.l1, transport: http('http://127.0.0.1:8545'), account: me });

async function send(pc: typeof l1, wc: typeof w1, address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await pc.simulateContract({ account: me, address, abi, functionName, args } as never);
  const hash = await wc.writeContract(request as never);
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
  return r;
}

async function main() {
  for (const c of [l1]) await c.request({ method: 'anvil_impersonateAccount' as never, params: [me] as never });

  // FRESH_FACTORY=1: redeploy CapitalAccount, PoolVault and PoolFactory from the current build (what
  // "redo from here" on /admin/deploy does), reusing the deployed adapters and Arbitrum contracts.
  if (process.env.FRESH_FACTORY) {
    const dep = async (art: { abi: Abi; bytecode: `0x${string}` }, args: unknown[]) => {
      const h = await w1.deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never);
      return (await l1.waitForTransactionReceipt({ hash: h })).contractAddress!;
    };
    const old = { address: factory, abi: A.PoolFactory.abi } as const;
    const [splitterImpl, fee] = await Promise.all([
      l1.readContract({ ...old, functionName: 'splitterImpl' }),
      l1.readContract({ ...old, functionName: 'feeBps' }),
    ]);
    factory = await dep(A.PoolFactory, [
      {
        admin: me,
        poolVaultImpl: await dep(A.PoolVault, []),
        capitalAccountImpl: await dep(A.CapitalAccount, []),
        adapter: testnet.ethereum.adapter,
        exitAdapter: testnet.ethereum.exitAdapter,
        splitterDeployer,
        splitterImpl,
        feeWallet: me,
        referralAddress: me,
        feeBps: fee,
        stakeTokens: net.stakeAssets.map((a) => a.token),
        depositPools: net.stakeAssets.map((a) => a.depositPool),
      },
    ]);
    console.log('fresh factory', factory);
  }

  // 1. Test reward token
  const hash = await w1.deployContract({ abi: A.MockERC20.abi, bytecode: A.MockERC20.bytecode, args: ['Test EXM', 'tEXM', 18] });
  const tleo = (await l1.waitForTransactionReceipt({ hash })).contractAddress!;
  await send(l1, w1, tleo, A.MockERC20.abi as Abi, 'mint', [me, parseUnits('42000000', 18)]);
  console.log('tEXM', tleo);

  // 2. Config from the same form defaults the page uses
  const form = defaultForm(net);
  form.rewardToken = tleo;
  // Dates from the fork's clock (it runs ahead of wall time after earlier warps).
  const now = Number((await l1.getBlock()).timestamp) * 1000;
  const local = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  form.start = local(Math.max(now, Date.now()) + 15 * 60_000);
  form.end = local(Math.max(now, Date.now()) + 180 * 86400_000);
  form.sleeves.LINK.enabled = true;
  form.sleeves.stETHMock.fixedEnabled = true;
  form.sleeves.stETHMock.fixedAmounts = '1, 5';
  const draft = buildConfig(form, net, 18);
  form.budget = (Number(draft.fullCapReward / 10n ** 18n) + 1).toString();
  const { cfg, errors, budget } = buildConfig(form, net, 18);
  if (errors.length) throw new Error(errors.join('; '));
  console.log('budget', budget, 'locks', cfg.lockOptions.length, 'sleeves', cfg.sleeves.length);

  // 3. Approve + createPool
  await send(l1, w1, tleo, erc20Abi as Abi, 'approve', [factory, budget]);
  const r = await send(l1, w1, factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: r.logs, eventName: 'PoolCreated' });
  console.log('vault', ev.args.vault, 'morReceiver', ev.args.morReceiver);

  // 4. The live Arbitrum SplitterDeployer predicts the same splitter address the vault was given
  const salt = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolSalt', args: [ev.args.vault] });
  const predicted = await l2.readContract({ address: splitterDeployer, abi: A.SplitterDeployer.abi, functionName: 'predict', args: [salt, me] });
  console.log('Arbitrum predicts morReceiver:', predicted === ev.args.morReceiver);

  // 5. Contributor stake into real Morpheus Sepolia (stETHMock is open-mint)
  await l1.request({ method: 'evm_increaseTime' as never, params: [17 * 60] as never });
  await l1.request({ method: 'evm_mine' as never, params: [] as never });
  const st = net.stakeAssets[0].token;
  await send(l1, w1, st, A.MockERC20.abi as Abi, 'mint', [me, parseUnits('10', 18)]);
  await send(l1, w1, st, erc20Abi as Abi, 'approve', [ev.args.vault, parseUnits('10', 18)]);
  const q = await l1.readContract({ address: ev.args.vault, abi: A.PoolVault.abi, functionName: 'quote', args: [0n, 0n, parseUnits('10', 18), 4n] });
  await send(l1, w1, ev.args.vault, A.PoolVault.abi as Abi, 'stake', [0n, 0n, parseUnits('10', 18), 4n]);
  const pos = await l1.readContract({ address: ev.args.vault, abi: A.PoolVault.abi, functionName: 'position', args: [0n] });
  const inMorpheus = await l1.readContract({ address: testnet.ethereum.adapter as Address, abi: A.MorpheusAdapter.abi, functionName: 'deposited', args: [net.stakeAssets[0].depositPool, pos.account] });
  console.log('quote', q, 'reserved', pos.reward, 'principal', pos.amount, 'in Morpheus', inMorpheus);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e);
  process.exit(1);
});
