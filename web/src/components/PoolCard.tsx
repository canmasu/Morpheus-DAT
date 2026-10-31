'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { readPool, type PoolDetail } from '@/lib/vault';
import { fmt, months, countdown } from '@/lib/format';
import { useChainNow } from '@/hooks/useChainNow';

export function PoolCard({ vault }: { vault: Address }) {
  const { net } = useNetwork();
  const [p, setP] = useState<PoolDetail>();
  const chainNow = useChainNow(net);
  useEffect(() => {
    readPool(net, vault).then(setP, () => {});
  }, [net, vault]);
  if (!p) return <div className="card h-40 animate-pulse" />;

  const now = BigInt(chainNow);
  const status = now < p.depositStart ? `opens in ${countdown(p.depositStart, chainNow)}` : now < p.depositEnd ? 'open' : 'closed';
  const best = p.locks.reduce((a, b) => (b.multBps > a.multBps ? b : a), p.locks[0]);

  return (
    <Link href={`/pool/?v=${vault}`} className="card block space-y-3 hover:border-mor/50">
      <div className="flex items-center justify-between">
        <div className="font-medium text-white">
          Earn {p.reward.symbol} {!p.featured && <span className="ml-2 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300">not featured</span>}
        </div>
        <span className={`text-xs ${status === 'open' ? 'text-mor' : 'text-slate-400'}`}>{status}</span>
      </div>
      {p.sleeves.map((s) => (
        <div key={s.id} className="text-sm text-slate-300">
          {fmt(s.ratePerUnit, p.reward.decimals)} {p.reward.symbol} / year per {fmt(s.unit, s.asset.decimals)} {s.asset.symbol}
          <span className="text-slate-500">
            {' '}
            · {fmt(s.totalStaked, s.asset.decimals)} / {fmt(s.cap, s.asset.decimals)} {s.asset.symbol} staked
          </span>
        </div>
      ))}
      <div className="text-xs text-slate-500">
        Locks {p.locks.map((l) => months(l.duration).replace(' months', '')).join(' / ')} months · up to {(best.multBps / 10000).toFixed(2)}x ·
        reward capacity {fmt(p.available, p.reward.decimals)} {p.reward.symbol}
      </div>
    </Link>
  );
}
