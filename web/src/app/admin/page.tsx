'use client';

import Link from 'next/link';
import { AdminGate } from '@/components/AdminGate';

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
          <div className="card opacity-50">
            <h2 className="font-medium text-white">Health</h2>
            <p className="text-sm text-slate-400">Morpheus baseline, Exit pending, splitter balances. Coming next.</p>
          </div>
        </div>
      </div>
    </AdminGate>
  );
}
