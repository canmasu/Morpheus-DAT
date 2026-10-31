'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/config/wagmi';
import { DEFAULT_NETWORK, NETWORKS, type NetworkConfig, type NetworkName } from '@/config/networks';
import { load, save } from '@/lib/storage';

const queryClient = new QueryClient();

type NetworkCtx = { net: NetworkConfig; setNetwork: (n: NetworkName) => void };
const NetworkContext = createContext<NetworkCtx>({ net: NETWORKS[DEFAULT_NETWORK], setNetwork: () => {} });
export const useNetwork = () => useContext(NetworkContext);

export function Providers({ children }: { children: ReactNode }) {
  const [name, setName] = useState<NetworkName>(DEFAULT_NETWORK);
  useEffect(() => {
    const stored = load<NetworkName>('dat-network');
    if (stored && stored in NETWORKS) setName(stored);
  }, []);
  const setNetwork = (n: NetworkName) => {
    setName(n);
    save('dat-network', n);
  };
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkContext.Provider value={{ net: NETWORKS[name], setNetwork }}>{children}</NetworkContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
