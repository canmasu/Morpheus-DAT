// Runs the admin deploy plan (src/lib/deployPlan.ts) against local anvil forks, impersonating an admin wallet.
//   anvil --fork-url <sepolia> --port 8545 --chain-id 11155111
//   anvil --fork-url <arbitrum sepolia> --port 8546 --chain-id 421614
//   npx tsx scripts/dry-run-deploy.ts
import { createPublicClient, createWalletClient, http, type Abi, type Address } from 'viem';
import { NETWORKS } from '../src/config/networks';
import { ADMIN_WALLETS } from '../src/config/admin';
import { DEFAULT_PARAMS, STEPS, toDeploymentsJson, type Ctx, type DeployState } from '../src/lib/deployPlan';

const net = NETWORKS.testnet;
const deployer = ADMIN_WALLETS[0];
const rpcs = { l1: 'http://127.0.0.1:8545', l2: 'http://127.0.0.1:8546' } as const;
const chains = { l1: net.l1, l2: net.l2 } as const;
const pub = { l1: createPublicClient({ chain: net.l1, transport: http(rpcs.l1) }), l2: createPublicClient({ chain: net.l2, transport: http(rpcs.l2) }) };
const wal = {
  l1: createWalletClient({ chain: net.l1, transport: http(rpcs.l1), account: deployer }),
  l2: createWalletClient({ chain: net.l2, transport: http(rpcs.l2), account: deployer }),
};

async function main() {
  for (const l of ['l1', 'l2'] as const) {
    await pub[l].request({ method: 'anvil_impersonateAccount' as never, params: [deployer] as never });
  }
  const state: DeployState = { network: 'testnet', deployer, params: DEFAULT_PARAMS(deployer), results: {} };
  const ctx = (): Ctx => ({
    net,
    deployer,
    params: state.params,
    results: state.results,
    deploy: async (layer, artifact, args) => {
      const hash = await wal[layer as 'l1'].deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, chain: chains[layer as 'l1'] } as never);
      const r = await pub[layer as 'l1'].waitForTransactionReceipt({ hash });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('deploy reverted');
      return { address: r.contractAddress, hash };
    },
    write: async (layer, address: Address, abi: Abi, functionName, args) => {
      const { request } = await pub[layer as 'l1'].simulateContract({ account: deployer, address, abi, functionName, args } as never);
      const hash = await wal[layer as 'l1'].writeContract(request as never);
      const r = await pub[layer as 'l1'].waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('tx reverted');
      return { hash };
    },
    read: (layer, address, abi, functionName, args) => pub[layer as 'l1'].readContract({ address, abi, functionName, args } as never),
  });
  for (const step of STEPS) {
    if (step.layer === 'base') continue; // needs a Base fork as well; covered by contracts/test/fork/BuildersFork.t.sol
    const c = ctx();
    if (step.skip?.(c)) {
      state.results[step.id] = { skipped: true };
      console.log(`skip  ${step.id}`);
      continue;
    }
    state.results[step.id] = await step.run(c);
    console.log(`done  ${step.id.padEnd(20)} ${state.results[step.id].address ?? ''}`);
  }
  console.log(JSON.stringify(toDeploymentsJson(state, net), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
