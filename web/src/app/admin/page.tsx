'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminGate } from '@/components/AdminGate';
import { useNetwork } from '@/components/Providers';
import { readStatus, type MorpheusStatus } from '@/lib/status';

export default function AdminHome() {
  return (
    <AdminGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">Admin</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/admin/deploy/" className="card hover:border-mor/50">
            <h2 className="font-medium text-white">Deploy</h2>
            <p className="text-sm text-slate-400">Deploy and configure every contract on testnet or mainnet.</p>
          </Link>
          <Link href="/admin/pools/" className="card hover:border-mor/50">
            <h2 className="font-medium text-white">Pools</h2>
            <p className="text-sm text-slate-400">Review pools and feature or unfeature them.</p>
          </Link>
          <Link href="/admin/health/" className="card hover:border-mor/50">
            <h2 className="font-medium text-white">Morpheus status</h2>
            <p className="text-sm text-slate-400">MOR claims, Morpheus settings vs baseline, pause state, referral MOR.</p>
            <MorpheusStatusLine />
          </Link>
        </div>
      </div>
    </AdminGate>
  );
}

/** One-line summary for the admin home card. */
function MorpheusStatusLine() {
  const { net } = useNetwork();
  const [st, setSt] = useState<MorpheusStatus>();
  useEffect(() => {
    readStatus(net).then(setSt, () => {});
  }, [net]);
  if (!st) return <p className="mt-2 text-xs text-slate-500">Checking…</p>;
  const items: [string, boolean][] = [
    ['MOR claims', st.lz.ok],
    ['New stakes', st.assets.every((a) => a.healthy)],
    ['Not paused', !!st.dat && !st.dat.depositsPaused && !st.dat.allPaused],
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map(([k, ok]) => (
        <span key={k} className={`rounded-full px-2 py-0.5 text-xs ${ok ? 'bg-mor/10 text-mor' : 'bg-red-500/10 text-red-300'}`}>
          {ok ? '●' : '●'} {k}
        </span>
      ))}
    </div>
  );
}
