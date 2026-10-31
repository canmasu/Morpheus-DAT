import { getAccount, getPublicClient, switchChain } from 'wagmi/actions';
import { createWalletClient, custom, type Abi, type Address, type Chain, type EIP1193Provider, type Hash, type PublicClient, type TransactionReceipt } from 'viem';
import { wagmiConfig } from '@/config/wagmi';
import { trackTx } from './txEvents';

export const publicClient = (chain: Chain) => getPublicClient(wagmiConfig, { chainId: chain.id as never }) as PublicClient;

/** Switches the wallet to `chain` (talking to its provider directly: wagmi's cached chain id can lag) and
 * returns a wallet client bound to it. */
export async function walletOn(chain: Chain, account: Address) {
  const { connector } = getAccount(wagmiConfig);
  if (!connector) throw new Error('Wallet not connected');
  const provider = (await connector.getProvider()) as EIP1193Provider;
  const current = async () => Number(await provider.request({ method: 'eth_chainId' }));
  if ((await current()) !== chain.id) {
    await switchChain(wagmiConfig, { chainId: chain.id as never });
    for (let i = 0; i < 40 && (await current()) !== chain.id; i++) await new Promise((r) => setTimeout(r, 250));
    if ((await current()) !== chain.id) throw new Error(`Please switch your wallet to ${chain.name} and retry`);
  }
  return createWalletClient({ account, chain, transport: custom(provider) });
}

/** Some RPCs (e.g. Arbitrum Sepolia) suggest a gas price below the base fee, so fees are set from the
 * latest base fee instead. Only the actual base fee + tip is charged. */
async function fees(chain: Chain) {
  const client = publicClient(chain);
  const block = await client.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  let tip = 0n;
  try {
    tip = await client.estimateMaxPriorityFeePerGas();
  } catch {
    // chains without priority fees
  }
  return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
}

export async function deploy(
  chain: Chain,
  account: Address,
  artifact: { abi: Abi; bytecode: `0x${string}` },
  args: unknown[],
  label?: string,
): Promise<{ address: Address; hash: Hash }> {
  const wallet = await walletOn(chain, account);
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, ...(await fees(chain)) } as never);
  const settle = trackTx(hash, chain, label ?? 'Deploy contract');
  const receipt = await publicClient(chain).waitForTransactionReceipt({ hash });
  const ok = receipt.status === 'success' && !!receipt.contractAddress;
  settle(ok ? 'success' : 'failed');
  if (!ok) throw new Error(`Deployment reverted (${hash})`);
  return { address: receipt.contractAddress!, hash };
}

/** Simulates first so a revert shows its reason before the wallet asks for a signature. */
export async function write(
  chain: Chain,
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
  value?: bigint,
): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  const wallet = await walletOn(chain, account);
  const client = publicClient(chain);
  const { request } = await client.simulateContract({ account, address, abi, functionName, args, value } as never);
  // 30% headroom: estimates run short when Morpheus makes inner calls with a fixed gas budget (seen on Sepolia).
  const gas = ((await client.estimateContractGas({ account, address, abi, functionName, args, value } as never)) * 13n) / 10n;
  const hash = await wallet.writeContract({ ...(request as object), gas, ...(await fees(chain)) } as never);
  const settle = trackTx(hash, chain, LABELS[functionName] ?? functionName);
  const receipt = await client.waitForTransactionReceipt({ hash });
  settle(receipt.status === 'success' ? 'success' : 'failed');
  if (receipt.status !== 'success') throw new Error(`Transaction reverted (${hash})`);
  return { hash, receipt };
}

/** Plain-language names for the contract calls the site sends. */
const LABELS: Record<string, string> = {
  approve: 'Approve',
  stake: 'Stake',
  claimReward: 'Claim reward',
  withdraw: 'Withdraw',
  processExit: 'Retry exit',
  exitEarly: 'Exit early',
  createPool: 'Create pool',
  deploySplitter: 'Deploy MOR splitter',
  claimMor: 'Claim MOR',
  distribute: 'Distribute MOR',
  setFeatured: 'Change featured flag',
  grantRole: 'Grant role',
  renounceRole: 'Renounce role',
  transferOwnership: 'Offer ownership',
  mint: 'Mint test tokens',
};

export function errorText(e: unknown) {
  const err = e as { shortMessage?: string; message?: string };
  return (err.shortMessage ?? err.message ?? String(e)).split('\n').slice(0, 3).join(' ');
}

/** approve() without a return value, so USDT (which returns nothing) decodes. */
const approveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** Approves `amount` if the current allowance is lower. Resets to 0 first, as USDT requires. */
export async function ensureAllowance(chain: Chain, account: Address, token: Address, spender: Address, amount: bigint) {
  const current = await publicClient(chain).readContract({ address: token, abi: approveAbi, functionName: 'allowance', args: [account, spender] });
  if (current >= amount) return;
  if (current > 0n) await write(chain, account, token, approveAbi as Abi, 'approve', [spender, 0n]);
  await write(chain, account, token, approveAbi as Abi, 'approve', [spender, amount]);
}
