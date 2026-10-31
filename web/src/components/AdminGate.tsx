'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { isAdmin } from '@/config/admin';
import { ConnectButton } from './ConnectButton';

/** UI gate only. On-chain roles decide what a wallet can change. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (!isConnected) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-lg font-medium text-white">Admin</h1>
        <p className="text-sm text-slate-400">Connect an admin wallet to continue.</p>
        <div className="flex justify-center">
          <ConnectButton />
        </div>
      </div>
    );
  }
  if (!isAdmin(address)) {
    return (
      <div className="card mx-auto max-w-md space-y-2 text-center">
        <h1 className="text-lg font-medium text-white">Not an admin wallet</h1>
        <p className="mono break-all text-slate-400">{address}</p>
        <p className="text-sm text-slate-400">This wallet is not on the admin list.</p>
      </div>
    );
  }
  return <>{children}</>;
}
