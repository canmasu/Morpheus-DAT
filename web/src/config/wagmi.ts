import { createConfig, http } from 'wagmi';
import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { localArbitrum, localEthereum } from './networks';
import { lzHomeChains, viemChain } from './bridge';

/** Token home chains the bridge kit can deploy on, except those already listed below. */
const LISTED = new Set<number>([sepolia.id, arbitrumSepolia.id, baseSepolia.id, mainnet.id, arbitrum.id, base.id]);
const homeChains = lzHomeChains().filter((c) => !LISTED.has(c.chainId)).map(viemChain);

const rpc = (env: string | undefined, fallback: string) => (env && env.length > 0 ? env : fallback);

export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia, baseSepolia, mainnet, arbitrum, base, localEthereum, localArbitrum, ...homeChains],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_SEPOLIA, 'https://ethereum-sepolia-rpc.publicnode.com')),
    [arbitrumSepolia.id]: http(
      rpc(process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA, 'https://arbitrum-sepolia-rpc.publicnode.com'),
    ),
    [baseSepolia.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA, 'https://sepolia.base.org')),
    [base.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_BASE, 'https://mainnet.base.org')),
    [mainnet.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_MAINNET, 'https://ethereum-rpc.publicnode.com')),
    [arbitrum.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_ARBITRUM, 'https://arbitrum-one-rpc.publicnode.com')),
    ...Object.fromEntries(homeChains.map((c) => [c.id, http(c.rpcUrls.default.http[0])])),
    [localEthereum.id]: http('http://127.0.0.1:8545'),
    [localArbitrum.id]: http('http://127.0.0.1:8546'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
