'use client';

import { useEffect, useState } from 'react';
import { explorerTx } from '@/config/networks';
import { dismissTx, subscribeTx, type TxNotice } from '@/lib/txEvents';
import { short } from '@/lib/format';

/** Bottom-right list of the site's recent transactions, each linking to the block explorer. */
export function TxToasts() {
  const [list, setList] = useState<TxNotice[]>([]);
  useEffect(() => subscribeTx(setList), []);

  // Confirmed transactions fade out after 20 seconds; pending and failed ones stay until dismissed.
  useEffect(() => {
    const t = setInterval(() => {
      for (const n of list) if (n.status === 'success' && Date.now() - n.at > 20_000) dismissTx(n.id);
    }, 2000);
    return () => clearInterval(t);
  }, [list]);

  if (list.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {list.map((n) => {
        const href = explorerTx(n.chain, n.hash);
        const tone =
          n.status === 'success' ? 'border-mor/40 text-mor' : n.status === 'failed' ? 'border-red-500/40 text-red-300' : 'border-amber-400/40 text-amber-300';
        return (
          <div key={n.id} className={`rounded-lg border bg-ink-soft px-3 py-2 text-xs shadow-lg ${tone}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {n.status === 'pending' ? '⏳' : n.status === 'success' ? '✓' : '✗'} {n.label}
                <span className="font-normal text-slate-400"> · {n.status === 'pending' ? 'pending' : n.status === 'success' ? 'confirmed' : 'failed'}</span>
              </span>
              <button className="text-slate-500 hover:text-slate-200" onClick={() => dismissTx(n.id)} aria-label="Dismiss">
                ×
              </button>
            </div>
            <div className="mt-0.5 text-slate-400">
              {n.chain.name} ·{' '}
              {href === '#' ? (
                <span className="mono">{short(n.hash)}</span>
              ) : (
                <a className="mono text-slate-200 underline hover:text-white" href={href} target="_blank" rel="noreferrer">
                  {short(n.hash)} ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
