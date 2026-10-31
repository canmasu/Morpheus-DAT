// Local sandbox: an anvil fork of Ethereum mainnet (live Morpheus Capital, real USDC/USDT) plus a plain anvil
// standing in for Arbitrum. Ctrl+C stops both; every start is a fresh fork.
//
//   npm run sandbox                     (uses ETH_RPC_URL, or a public RPC)
//
// Setup after start:
//  - Morpheus's ChainLinkDataConsumer is replaced by SandboxPriceConsumer holding today's prices, so Morpheus
//    keeps working after the sandbox page skips months ahead (live feeds would go stale).
//  - A stand-in MOR token is deployed on the local Arbitrum at SANDBOX_MOR (first deploy, nonce 0).
//  - Admin wallets from src/config/admin.ts get 100 ETH on both chains.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, '..', 'contracts', 'out');
const artifact = (file, name) => JSON.parse(readFileSync(join(out, `${file}.sol`, `${name}.json`), 'utf8'));

const FORK_RPC = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const L1 = { id: 31337, name: 'Sandbox Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } };
const L2 = { id: 31338, name: 'Sandbox Arbitrum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8546'] } } };
const DISTRIBUTOR = '0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A';
const SANDBOX_MOR = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
// anvil's well-known first dev account; only ever used on these local chains.
const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const admins = [...readFileSync(join(root, 'src/config/admin.ts'), 'utf8').matchAll(/'(0x[0-9a-fA-F]{40})'/g)].map((m) => m[1]);

const procs = [
  spawn('anvil', ['--fork-url', FORK_RPC, '--port', '8545', '--chain-id', String(L1.id), '--silent'], { stdio: 'inherit' }),
  spawn('anvil', ['--port', '8546', '--chain-id', String(L2.id), '--silent'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());

const l1 = createPublicClient({ chain: L1, transport: http() });
const l2 = createPublicClient({ chain: L2, transport: http() });

async function ready(client, name) {
  for (let i = 0; i < 120; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${name} did not start`);
}

async function main() {
  await Promise.all([ready(l1, 'Ethereum fork'), ready(l2, 'Arbitrum')]);

  // Stand-in MOR on the local Arbitrum.
  const dev = privateKeyToAccount(DEV_KEY);
  const w2 = createWalletClient({ chain: L2, transport: http(), account: dev });
  const mock = artifact('Mocks', 'MockERC20');
  const hash = await w2.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: ['Morpheus (sandbox)', 'MOR', 18] });
  const mor = (await l2.waitForTransactionReceipt({ hash })).contractAddress;
  if (mor.toLowerCase() !== SANDBOX_MOR.toLowerCase()) throw new Error(`MOR deployed at ${mor}, expected ${SANDBOX_MOR}`);

  // Freeze Morpheus prices: read today's values, then swap in the fixed-price consumer.
  const dist = parseAbi([
    'function chainLinkDataConsumer() view returns (address)',
    'function depositPoolAddresses(uint256, uint256) view returns (address)',
    'function depositPools(uint256, address) view returns (address, string, uint256, uint256, uint256, uint8, address, bool)',
  ]);
  const consumerAbi = parseAbi([
    'function getPathId(string) pure returns (bytes32)',
    'function getChainLinkDataFeedLatestAnswer(bytes32) view returns (uint256)',
    'function setPrice(bytes32, uint256)',
  ]);
  const consumer = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'chainLinkDataConsumer' });
  const prices = [];
  for (let i = 0; ; i++) {
    let pool;
    try {
      pool = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'depositPoolAddresses', args: [0n, BigInt(i)] });
    } catch {
      break;
    }
    const [, path] = await l1.readContract({ address: DISTRIBUTOR, abi: dist, functionName: 'depositPools', args: [0n, pool] });
    const id = await l1.readContract({ address: consumer, abi: consumerAbi, functionName: 'getPathId', args: [path] });
    const price = await l1.readContract({ address: consumer, abi: consumerAbi, functionName: 'getChainLinkDataFeedLatestAnswer', args: [id] });
    prices.push({ path, id, price });
  }
  const stub = artifact('SandboxPriceConsumer', 'SandboxPriceConsumer');
  await l1.request({ method: 'anvil_setCode', params: [consumer, stub.deployedBytecode.object] });
  await l1.request({ method: 'anvil_setBalance', params: [dev.address, '0x56BC75E2D63100000'] });
  const w1 = createWalletClient({ chain: L1, transport: http(), account: dev });
  for (const p of prices) {
    const h = await w1.writeContract({ address: consumer, abi: consumerAbi, functionName: 'setPrice', args: [p.id, p.price] });
    await l1.waitForTransactionReceipt({ hash: h });
  }

  for (const a of admins) {
    for (const c of [l1, l2]) await c.request({ method: 'anvil_setBalance', params: [a, '0x56BC75E2D63100000'] });
  }

  const block = await l1.getBlockNumber();
  console.log(`
Morpheus DAT sandbox is running (Ctrl+C to stop)
  Sandbox Ethereum  http://127.0.0.1:8545  chain 31337  (mainnet fork @ ${block})
  Sandbox Arbitrum  http://127.0.0.1:8546  chain 31338
  MOR (sandbox)     ${mor}
  Prices frozen     ${prices.map((p) => p.path).join(', ')}
  Funded 100 ETH    ${admins.join(', ')}

Next: open http://localhost:3000, choose "Local sandbox" in the network menu, then Admin → Deploy.
`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e);
  stop();
});
