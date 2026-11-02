'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import type { Address, Chain } from 'viem';
import { addTokenToWallet, errorText } from '@/lib/tx';

/** "+ Add TOKEN to wallet": asks MetaMask (or any connected wallet) to show the token. */
export function AddToWallet({ chain, token, symbol, decimals, className = '' }: { chain: Chain; token: Address; symbol: string; decimals: number; className?: string }) {
  const { address, isConnected } = useAccount();
  const [state, setState] = useState<'idle' | 'busy' | 'added' | 'error'>('idle');
  const [msg, setMsg] = useState<string>();
  if (!isConnected) return null;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        className="inline-flex items-center gap-1 rounded-full border border-ink-line px-2.5 py-1 text-xs text-slate-300 hover:border-mor/50 hover:text-mor disabled:opacity-50"
        disabled={state === 'busy'}
        title={`Show ${symbol} in your wallet`}
        onClick={async () => {
          setState('busy');
          setMsg(undefined);
          try {
            const ok = await addTokenToWallet(chain, address!, token, symbol, decimals);
            setState(ok ? 'added' : 'idle');
          } catch (e) {
            setState('error');
            setMsg(errorText(e));
          }
        }}
      >
        {state === 'added' ? '✓ Added' : state === 'busy' ? 'Check your wallet…' : `+ Add ${symbol} to wallet`}
      </button>
      {state === 'error' && <span className="text-[11px] text-red-300">{msg}</span>}
    </span>
  );
}
