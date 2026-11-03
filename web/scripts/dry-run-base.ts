// Full MOR pool flow, using the website's own deploy plan and pool builder.
// Against live Morpheus, on a fork of Base:
//   anvil --fork-url https://mainnet.base.org --port 8547 &
//   npx tsx scripts/dry-run-base.ts
// Against the testnet simulation, on an empty chain:
//   anvil --chain-id 84532 --port 8547 &
//   SIM=1 npx tsx scripts/dry-run-base.ts
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, formatUnits, http, parseEventLogs, parseUnits, type Abi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import * as A from '../src/contracts/artifacts';
import { NETWORKS, baseNet } from '../src/config/networks';
import { DEFAULT_PARAMS, STEPS, type Ctx, type DeployState } from '../src/lib/deployPlan';
import { buildConfig, defaultForm } from '../src/lib/pool';

const RPC = 'http://127.0.0.1:8547';
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const SIM = !!process.env.SIM;
const chain = SIM ? baseSepolia : base;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = createWalletClient({ chain, transport: http(RPC), account });
const test = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });

async function send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await pub.simulateContract({ account, address, abi, functionName, args } as never);
  const hash = await wal.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
  return r;
}

async function main() {
  const net = SIM ? NETWORKS.testnet : NETWORKS.mainnet;
  const state: DeployState = { network: net.name, params: { ...DEFAULT_PARAMS(account.address), referral: '' }, results: {} };
  for (const step of STEPS.filter((s) => s.layer === 'base')) {
    const ctx: Ctx = {
      net,
      deployer: account.address,
      params: state.params,
      results: state.results,
      deploy: async (_l, art, args) => {
        const hash = await wal.deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never);
        const r = await pub.waitForTransactionReceipt({ hash });
        if (r.status !== 'success') throw new Error('deploy reverted');
        return { address: r.contractAddress!, hash };
      },
      write: async (_l, address, abi, fn, args) => ({ hash: (await send(address, abi, fn, args)).transactionHash }),
      read: (_l, address, abi, functionName, args) => pub.readContract({ address, abi, functionName, args } as never),
    };
    state.results[step.id] = step.skip?.(ctx) ? { skipped: true } : await step.run(ctx);
  }
  // The site reads simulated addresses from the committed deployment; here they come straight from the run.
  const view = {
    ...baseNet(net)!,
    ...(SIM ? { mor: state.results.simMor.address!, stakeAssets: [{ symbol: 'MOR', token: state.results.simMor.address!, decimals: 18, depositPool: state.results.simBuilders.address!, poolIndex: 0 }] } : {}),
  };
  const factory = state.results.baseFactory.address!;
  const deployer = state.results.baseSplitterDeployer.address!;
  console.log('deployed BuilderPoolFactory', factory);

  const hash = await wal.deployContract({ abi: A.MockERC20.abi, bytecode: A.MockERC20.bytecode, args: ['OG Test', 'OGT', 18] } as never);
  const og = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  await send(og, A.MockERC20.abi as Abi, 'mint', [account.address, parseUnits('1000000', 18)]);
  await send(og, erc20Abi as Abi, 'approve', [factory, parseUnits('1000000', 18)]);

  const block = await pub.getBlock();
  const nowMs = Number(block.timestamp) * 1000;
  const form = defaultForm(view, nowMs);
  form.rewardToken = og;
  form.budget = '1000000';
  form.locks = [{ months: '12', mult: '1' }];
  form.sleeves.MOR = { ...form.sleeves.MOR, enabled: true, perToken: '1', cap: '100000', minPerWallet: '1' };
  const built = buildConfig(form, view, 18, nowMs);
  if (built.errors.length) throw new Error(built.errors.join('; '));

  const name = `DAT dry run ${block.timestamp}`;
  const r = await send(factory, A.BuilderPoolFactory.abi as Abi, 'createBuilderPool', [
    built.cfg,
    built.budget,
    name,
    { slug: 'dat-dry-run', description: 'dry run', website: 'https://example.org', image: '' },
  ]);
  const [ev] = parseEventLogs({ abi: A.PoolFactory.abi, logs: r.logs, eventName: 'PoolCreated' });
  const vault = ev.args.vault;
  const receiver = ev.args.morReceiver;
  console.log('pool', vault, 'splitter', receiver);

  const mor = view.mor;
  const amount = parseUnits('10000', 18);
  if (SIM) {
    await send(mor, A.MockERC20.abi as Abi, 'mint', [account.address, amount]);
  } else {
    // Give the wallet MOR: the Builders contract holds plenty on the fork.
  const whale = net.builders!.contract;
  await test.impersonateAccount({ address: whale });
  await test.setBalance({ address: whale, value: parseUnits('1', 18) });
  const fund = await wal.writeContract({ account: whale, address: mor, abi: erc20Abi, functionName: 'transfer', args: [account.address, amount] } as never);
  await pub.waitForTransactionReceipt({ hash: fund });
  await test.stopImpersonatingAccount({ address: whale });
  }

  await send(mor, erc20Abi as Abi, 'approve', [vault, amount]);
  await test.increaseTime({ seconds: 3600 });
  await test.mine({ blocks: 1 });
  await send(vault, A.PoolVault.abi as Abi, 'stake', [0n, 0n, amount, 0n]);
  console.log('staked 10,000 MOR; left in wallet', formatUnits(await pub.readContract({ address: mor, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }), 18));

  await test.increaseTime({ seconds: 30 * 86400 });
  await test.mine({ blocks: 1 });
  const pending = await pub.readContract({ address: vault, abi: A.BuilderVault.abi, functionName: 'pendingSubnetMor' });
  console.log('subnet MOR after 30 days', formatUnits(pending, 18));
  await send(vault, A.BuilderVault.abi as Abi, 'claimSubnetMor', []);
  const salt = await pub.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolSalt', args: [vault] });
  await send(deployer, A.SplitterDeployer.abi as Abi, 'deploySplitter', [salt, account.address]);
  await send(receiver, A.MorSplitter.abi as Abi, 'distribute', []);
  console.log('Partner MOR after payout (fee wallet is the same wallet here)', formatUnits(await pub.readContract({ address: mor, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }), 18));

  await test.increaseTime({ seconds: 336 * 86400 });
  await test.mine({ blocks: 1 });
  await send(vault, A.PoolVault.abi as Abi, 'withdraw', [0n]);
  console.log('after withdraw', formatUnits(await pub.readContract({ address: mor, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }), 18), 'MOR');
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
