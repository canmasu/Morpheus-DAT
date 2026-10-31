'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNetwork } from '@/components/Providers';
import { PoolCard } from '@/components/PoolCard';
import { allPools } from '@/lib/vault';
import { errorText } from '@/lib/tx';
import type { Address } from 'viem';

export default function PoolsPage() {
  const { net } = useNetwork();
  const [pools, setPools] = useState<{ vault: Address; featured: boolean }[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setPools(undefined);
    allPools(net).then(setPools, (e) => setError(errorText(e)));
  }, [net]);

  const featured = pools?.filter((p) => p.featured) ?? [];
  // Docs rule: non-featured pools are never listed on mainnet, only reachable by direct link.
  const others = net.name === 'testnet' ? (pools?.filter((p) => !p.featured) ?? []) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Pools</h1>
        <p className="mt-1 text-sm text-slate-400">
          Stake {net.stakeAssets.map((a) => a.symbol).join(' or ')}. Keep your principal. Earn Partner Tokens, fixed when you stake.
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!pools && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {pools && featured.length === 0 && <p className="text-sm text-slate-500">No featured pools yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {featured.map((p) => (
          <PoolCard key={p.vault} vault={p.vault} />
        ))}
      </div>
      {others.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-amber-300">Not featured (shown on testnet only)</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {others.map((p) => (
              <PoolCard key={p.vault} vault={p.vault} />
            ))}
          </div>
        </section>
      )}
      <p className="text-xs text-slate-500">
        Partners: <Link className="text-mor hover:underline" href="/partner/create/">create a pool</Link>.
      </p>
    </div>
  );
}
