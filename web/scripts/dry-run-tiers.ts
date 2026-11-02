// Sepolia fork: fresh PoolVault/PoolFactory from the current build, a pool from "Fill Example pool"
// (LINK = USDC tiers 1:1, stETHMock 1 = $1,000), on-chain quotes vs the proposal table, one Alpha stake.
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseEventLogs, parseUnits, type Abi, type Address } from 'viem';
import * as A from '../src/contracts/artifacts';
import { NETWORKS } from '../src/config/networks';
import { ADMIN_WALLETS } from '../src/config/admin';
import { applyExamplePool, buildConfig, defaultForm } from '../src/lib/pool';
import testnet from '../src/deployments/testnet.json';

const net = NETWORKS.testnet;
const me = ADMIN_WALLETS[0];
const t = http('http://127.0.0.1:8545', { timeout: 180_000 });
const l1 = createPublicClient({ chain: net.l1, transport: t });
const w1 = createWalletClient({ chain: net.l1, transport: t, account: me });
const rpc = (m: string, p: unknown[]) => l1.request({ method: m as never, params: p as never });
const send = async (address: Address, abi: Abi, functionName: string, args: unknown[]) => {
  const { request } = await l1.simulateContract({ account: me, address, abi, functionName, args } as never);
  const gas = ((await l1.estimateContractGas({ account: me, address, abi, functionName, args } as never)) * 13n) / 10n;
  const r = await l1.waitForTransactionReceipt({ hash: await w1.writeContract({ ...(request as object), gas } as never) });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
  return r;
};
const dep = async (art: { abi: Abi; bytecode: `0x${string}` }, args: unknown[]) =>
  (await l1.waitForTransactionReceipt({ hash: await w1.deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never) })).contractAddress!;

async function main() {
  await rpc('anvil_impersonateAccount', [me]);
  await rpc('anvil_setBalance', [me, '0x56BC75E2D63100000']);
  const old = { address: testnet.ethereum.poolFactory as Address, abi: A.PoolFactory.abi } as const;
  // FRESH_FACTORY=1 deploys the current build; otherwise the committed testnet factory is used.
  const factory = !process.env.FRESH_FACTORY ? (testnet.ethereum.poolFactory as Address) : await dep(A.PoolFactory, [{
    admin: me, poolVaultImpl: await dep(A.PoolVault, []),
    capitalAccountImpl: await l1.readContract({ ...old, functionName: 'capitalAccountImpl' }),
    adapter: testnet.ethereum.adapter, exitAdapter: testnet.ethereum.exitAdapter,
    splitterDeployer: testnet.arbitrum.splitterDeployer, splitterImpl: await l1.readContract({ ...old, functionName: 'splitterImpl' }),
    feeWallet: me, referralAddress: me, feeBps: 1000,
    stakeTokens: net.stakeAssets.map((a) => a.token), depositPools: net.stakeAssets.map((a) => a.depositPool),
  }]);
  console.log('factory', factory);
  const tleo = await dep(A.MockERC20, ['Test EXM', 'tEXM', 18]);
  await send(tleo, A.MockERC20.abi as Abi, 'mint', [me, parseUnits('42000000', 18)]);

  const nowMs = Number((await l1.getBlock()).timestamp) * 1000;
  const form = applyExamplePool(defaultForm(net, nowMs), net);
  form.rewardToken = tleo;
  form.budget = '10000000';
  const { cfg, errors, budget } = buildConfig(form, net, 18, nowMs);
  if (errors.length) throw new Error(errors.join('; '));
  await send(tleo, A.MockERC20.abi as Abi, 'approve', [factory, budget]);
  const r = await send(factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const vault = parseEventLogs({ abi: A.PoolFactory.abi, logs: r.logs, eventName: 'PoolCreated' })[0].args.vault;
  const v = { address: vault, abi: A.PoolVault.abi } as const;

  for (const [si, a] of net.stakeAssets.entries()) {
    const f = a.symbol === 'LINK' ? 1 : 1000;
    console.log(`\n${a.symbol} (1 ${a.symbol} = $${f})`);
    for (const usd of [100, 999, 1_000, 10_000, 100_000, 999_999]) {
      const amt = parseUnits(String(usd / f), a.decimals);
      const q = await l1.readContract({ ...v, functionName: 'quote', args: [BigInt(si), 1n, amt, 0n] });
      console.log(`  Alpha ${usd / f} ${a.symbol}: ${formatUnits(q, 18)} tEXM / 12 months`);
    }
    for (const [li, m] of ['12', '24', '36', '48', '60'].entries()) {
      const q = await l1.readContract({ ...v, functionName: 'quote', args: [BigInt(si), 0n, parseUnits(String(1_000_000 / f), a.decimals), BigInt(li)] });
      console.log(`  Omega ${1_000_000 / f} ${a.symbol}, ${m}m: ${formatUnits(q, 18)} tEXM total (${Number(formatUnits(q, 18)) / (Number(m) / 12)} / year)`);
    }
  }

  // Real Alpha stake: 150 LINK (the $100 bracket) into Morpheus Sepolia via Aave
  await rpc('evm_increaseTime', [16 * 60]);
  await rpc('evm_mine', []);
  const link = net.stakeAssets.find((a) => a.symbol === 'LINK')!;
  const li = BigInt(net.stakeAssets.indexOf(link));
  await send(link.faucet as Address, parseAbi(['function mint(address,address,uint256) returns (uint256)']) as Abi, 'mint', [link.token, me, parseUnits('150', 18)]);
  await send(link.token, A.MockERC20.abi as Abi, 'approve', [vault, parseUnits('150', 18)]);
  await send(vault, A.PoolVault.abi as Abi, 'stake', [li, 1n, parseUnits('150', 18), 0n]);
  const pos = await l1.readContract({ ...v, functionName: 'position', args: [0n] });
  console.log(`\nStaked 150 LINK in Alpha: reward ${formatUnits(pos.reward, 18)} tEXM, lock ${(Number(pos.end) - Number(pos.start)) / 86400} days`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e);
  process.exit(1);
});
