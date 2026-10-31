// Sepolia fork: DAT pool with a LINK sleeve → Morpheus Sepolia LINK pool (Aave strategy) → withdraw from Aave.
// Uses the committed testnet deployment. Start: anvil --fork-url <sepolia> --port 8545 --chain-id 11155111
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, parseUnits, type Abi, type Address } from 'viem';
import * as A from '../src/contracts/artifacts';
import { NETWORKS } from '../src/config/networks';
import { ADMIN_WALLETS } from '../src/config/admin';
import { buildConfig, defaultForm } from '../src/lib/pool';
import testnet from '../src/deployments/testnet.json';
import { readFileSync } from 'node:fs';

const net = NETWORKS.testnet;
const me = ADMIN_WALLETS[0];
let factory = testnet.ethereum.poolFactory as Address;
const AAVE_FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D';
const LINK = net.stakeAssets.find((a) => a.symbol === 'LINK')!;
const ALINK = '0x3FfAf50D4F4E96eB78f2407c090b72e86eCaed24';
const DISTRIBUTOR = net.morpheus.distributor;
const t = http('http://127.0.0.1:8545', { timeout: 180_000 });
const l1 = createPublicClient({ chain: net.l1, transport: t });
const w1 = createWalletClient({ chain: net.l1, transport: t, account: me });
const rpc = (m: string, p: unknown[]) => l1.request({ method: m as never, params: p as never });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);

async function send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await l1.simulateContract({ account: me, address, abi, functionName, args } as never);
  const gas = ((await l1.estimateContractGas({ account: me, address, abi, functionName, args } as never)) * 13n) / 10n;
  const r = await l1.waitForTransactionReceipt({ hash: await w1.writeContract({ ...(request as object), gas } as never) });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
  return r;
}

async function main() {
  await rpc('anvil_impersonateAccount', [me]);
  await rpc('anvil_setBalance', [me, '0x56BC75E2D63100000']);

  // Freeze Morpheus Sepolia prices (same stub as the sandbox) so the year skip keeps Chainlink "fresh".
  const dist = parseAbi([
    'function chainLinkDataConsumer() view returns (address)',
    'function depositPoolAddresses(uint256,uint256) view returns (address)',
    'function depositPools(uint256,address) view returns (address,string,uint256,uint256,uint256,uint8,address,bool)',
  ]);
  const cons = parseAbi(['function getPathId(string) pure returns (bytes32)', 'function getChainLinkDataFeedLatestAnswer(bytes32) view returns (uint256)', 'function setPrice(bytes32,uint256)']);
  const consumer = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'chainLinkDataConsumer' });
  const prices: [`0x${string}`, bigint][] = [];
  for (let i = 0; ; i++) {
    let p: Address;
    try { p = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'depositPoolAddresses', args: [0n, BigInt(i)] }); } catch { break; }
    const [, path, , , , strategy] = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'depositPools', args: [0n, p] });
    const id = await l1.readContract({ address: consumer, abi: cons, functionName: 'getPathId', args: [path] });
    prices.push([id, await l1.readContract({ address: consumer, abi: cons, functionName: 'getChainLinkDataFeedLatestAnswer', args: [id] })]);
    console.log('morpheus pool', path, 'strategy', strategy === 2 ? 'AAVE' : strategy);
  }
  const stub = JSON.parse(readFileSync('../contracts/out/SandboxPriceConsumer.sol/SandboxPriceConsumer.json', 'utf8'));
  await rpc('anvil_setCode', [consumer, stub.deployedBytecode.object]);
  for (const [id, price] of prices) await send(consumer, cons as Abi, 'setPrice', [id, price]);

  // Fresh PoolVault implementation + factory from the current build (what "redo from here" on PoolVault does).
  {
    const dep = async (art: { abi: Abi; bytecode: `0x${string}` }, args: unknown[]) =>
      (await l1.waitForTransactionReceipt({ hash: await w1.deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never) })).contractAddress!;
    const old = { address: factory, abi: A.PoolFactory.abi } as const;
    factory = await dep(A.PoolFactory, [{
      admin: me,
      poolVaultImpl: await dep(A.PoolVault, []),
      capitalAccountImpl: await l1.readContract({ ...old, functionName: 'capitalAccountImpl' }),
      adapter: testnet.ethereum.adapter, exitAdapter: testnet.ethereum.exitAdapter,
      splitterDeployer: testnet.arbitrum.splitterDeployer, splitterImpl: await l1.readContract({ ...old, functionName: 'splitterImpl' }),
      feeWallet: me, referralAddress: me, feeBps: 1000,
      stakeTokens: net.stakeAssets.map((a) => a.token), depositPools: net.stakeAssets.map((a) => a.depositPool),
    }]);
  }

  // Pool: tEXM reward, LINK sleeve only, 1.1-month lock (shortest allowed with a 1-day epoch)
  const tx = await w1.deployContract({ abi: A.MockERC20.abi, bytecode: A.MockERC20.bytecode, args: ['Test EXM', 'tEXM', 18] });
  const tleo = (await l1.waitForTransactionReceipt({ hash: tx })).contractAddress!;
  await send(tleo, A.MockERC20.abi as Abi, 'mint', [me, parseUnits('42000000', 18)]);
  const nowMs = Number((await l1.getBlock()).timestamp) * 1000;
  const form = defaultForm(net, nowMs);
  form.rewardToken = tleo;
  form.sleeves.stETHMock.enabled = false;
  form.sleeves.LINK.enabled = true;
  form.sleeves.LINK.minPerWallet = '1';
  form.epochDays = '1';
  form.locks = [{ months: '1.1', mult: '1.00' }];
  form.budget = '1000000';
  const { cfg, errors, budget } = buildConfig(form, net, 18, nowMs);
  if (errors.length) throw new Error(errors.join('; '));
  await send(tleo, erc as Abi, 'approve', [factory, budget]);
  const r = await send(factory, A.PoolFactory.abi as Abi, 'createPool', [cfg, budget]);
  const vault = parseEventLogs({ abi: A.PoolFactory.abi, logs: r.logs, eventName: 'PoolCreated' })[0].args.vault;
  console.log('pool', vault);

  // LINK from Aave's Sepolia faucet, stake 100 LINK
  await rpc('evm_increaseTime', [16 * 60]);
  await rpc('evm_mine', []);
  await send(AAVE_FAUCET, parseAbi(['function mint(address,address,uint256) returns (uint256)']) as Abi, 'mint', [LINK.token, me, parseUnits('3', 18)]);
  await send(LINK.token, erc as Abi, 'approve', [vault, parseUnits('3', 18)]);
  const aBefore = await l1.readContract({ address: ALINK, abi: erc, functionName: 'balanceOf', args: [DISTRIBUTOR] });
  await send(vault, A.PoolVault.abi as Abi, 'stake', [0n, 0n, parseUnits('3', 18), 0n]);
  const aAfter = await l1.readContract({ address: ALINK, abi: erc, functionName: 'balanceOf', args: [DISTRIBUTOR] });
  const pos = await l1.readContract({ address: vault, abi: A.PoolVault.abi, functionName: 'position', args: [0n] });
  console.log('staked', pos.amount, '| Morpheus aLINK in Aave +', aAfter - aBefore, '| reward', pos.reward);

  // Skip past the lock and withdraw: Morpheus pulls LINK back out of Aave
  await rpc('evm_increaseTime', [40 * 86400]);
  await rpc('evm_mine', []);
  await send(LINK.token, erc as Abi, 'approve', [vault, 0n]);
  await send(AAVE_FAUCET, parseAbi(['function mint(address,address,uint256) returns (uint256)']) as Abi, 'mint', [LINK.token, vault, 10n]); // dust reserve
  if (process.env.STOP) { console.log('VAULT', vault); return; }
  const before = await l1.readContract({ address: LINK.token, abi: erc, functionName: 'balanceOf', args: [me] });
  await send(vault, A.PoolVault.abi as Abi, 'withdraw', [0n]);
  // Morpheus Sepolia releases 1 LINK per call: keep retrying the exit until it is paid
  for (let i = 0; i < 10; i++) {
    const p = await l1.readContract({ address: vault, abi: A.PoolVault.abi, functionName: 'position', args: [0n] });
    if (Number(p.status) === 2) break;
    console.log('  exit pending, retry', i + 1);
    await send(vault, A.PoolVault.abi as Abi, 'processExit', [0n]);
  }
  const after = await l1.readContract({ address: LINK.token, abi: erc, functionName: 'balanceOf', args: [me] });
  const st = await l1.readContract({ address: vault, abi: A.PoolVault.abi, functionName: 'position', args: [0n] });
  console.log('LINK back', after - before, '| status', ['Active', 'ExitPending', 'Withdrawn'][Number(st.status)], '| reward claimed', st.claimed);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e);
  process.exit(1);
});
