import { createConfig, http } from 'wagmi';
import { arbitrum, arbitrumSepolia, mainnet, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const rpc = (env: string | undefined, fallback: string) => (env && env.length > 0 ? env : fallback);

export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia, mainnet, arbitrum],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_SEPOLIA, 'https://ethereum-sepolia-rpc.publicnode.com')),
    [arbitrumSepolia.id]: http(
      rpc(process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA, 'https://arbitrum-sepolia-rpc.publicnode.com'),
    ),
    [mainnet.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_MAINNET, 'https://ethereum-rpc.publicnode.com')),
    [arbitrum.id]: http(rpc(process.env.NEXT_PUBLIC_RPC_ARBITRUM, 'https://arbitrum-one-rpc.publicnode.com')),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
