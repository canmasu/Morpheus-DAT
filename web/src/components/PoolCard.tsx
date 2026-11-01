'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { TokenIcon } from './TokenIcon';
import { CapacityRing } from './CapacityRing';
import { explorerAddress } from '@/config/networks';
import { readPool, type PoolDetail } from '@/lib/vault';
import { baseMultBps, fmtMult, reward } from '@/lib/pool';
import { fmt, months, countdown, short } from '@/lib/format';
import { useChainNow } from '@/hooks/useChainNow';

const YEAR = 365n * 86400n;

export function PoolCard({ vault }: { vault: Address }) {
  const { net } = useNetwork();
  const [p, setP] = useState<PoolDetail>();
  const chainNow = useChainNow(net);
  useEffect(() => {
    readPool(net, vault).then(setP, () => {});
  }, [net, vault]);
  if (!p) return <div className="h-72 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;

  const now = BigInt(chainNow);
  const status =
    now < p.depositStart
      ? { label: `Opens in ${countdown(p.depositStart, chainNow)}`, tone: 'bg-sky-500/10 text-sky-300' }
      : now < p.depositEnd
        ? { label: 'Open', tone: 'bg-mor/10 text-mor' }
        : { label: 'Closed', tone: 'bg-white/5 text-slate-400' };
  // All multipliers in the pool (locks + Alpha brackets), shown relative to the lowest one.
  const tiers = p.sleeves.flatMap((s) => s.tiers);
  const mults = [...p.locks.map((l) => l.multBps), ...tiers.filter((t) => t.kind !== 0).flatMap((t) => [...t.multBps])];
  const minMult = Math.min(...mults);
  const maxMult = Math.max(...mults);
  const base = baseMultBps(p.locks, tiers);
  const shortest = p.locks.reduce((a, b) => (b.duration < a.duration ? b : a), p.locks[0]);
  const longest = p.locks.reduce((a, b) => (b.duration > a.duration ? b : a), p.locks[0]);
  const lockRange =
    shortest.duration === longest.duration
      ? months(shortest.duration)
      : `${months(shortest.duration).replace(' months', '')} – ${months(longest.duration)}`;
  const href = `/pool/?v=${vault}`;

  return (
    <div className="flex flex-col rounded-2xl border border-ink-line bg-ink-soft p-5 transition hover:border-slate-600">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TokenIcon symbol={p.reward.symbol} reward size={40} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-white">{p.reward.symbol} pool</span>
              {!p.featured && <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">not featured</span>}
            </div>
            <div className="text-xs text-slate-500">Partner {short(p.partner)}</div>
          </div>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
      </div>

      {/* rewards */}
      <div className="mt-5 space-y-3">
        <div className="text-xs text-slate-500">
          Reward per year, by tier and lock ({fmtMult(minMult, base)} – {fmtMult(maxMult, base)})
        </div>
        {p.sleeves.map((s) => {
          const lo = reward(s.unit, s.ratePerUnit, s.unit, minMult, YEAR);
          const hi = reward(s.unit, s.ratePerUnit, s.unit, maxMult, YEAR);
          return (
            <div key={s.id} className="flex items-center gap-3">
              <TokenIcon symbol={s.asset.symbol} size={28} />
              <div className="min-w-0">
                <div className="text-xl font-semibold tracking-tight text-white">
                  {fmt(lo, p.reward.decimals)}
                  {hi !== lo && <span> – {fmt(hi, p.reward.decimals)}</span>}{' '}
                  <span className="text-sm font-normal text-slate-400">{p.reward.symbol}</span>
                </div>
                <div className="text-xs text-slate-500">
                  per {fmt(s.unit, s.asset.decimals)} {s.asset.symbol} staked
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="my-5 border-t border-ink-line" />

      {/* stats */}
      <dl className="space-y-2.5 text-sm">
        {p.sleeves.map((s) => {
          const ratio = s.cap === 0n ? 0 : Number((s.totalStaked * 1_000_000n) / s.cap) / 1_000_000;
          return (
            <div key={s.id} className="flex items-center justify-between">
              <dt className="text-slate-400">Capacity filled{p.sleeves.length > 1 ? ` · ${s.asset.symbol}` : ''}</dt>
              <dd className="flex items-center gap-2 text-white">
                <CapacityRing ratio={ratio} />
                {ratio > 0 && ratio < 0.001 ? '<0.1' : (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%
              </dd>
            </div>
          );
        })}
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Reward capacity left</dt>
          <dd className="text-white">
            {fmt(p.available, p.reward.decimals, 0)} {p.reward.symbol}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Lock</dt>
          <dd className="text-white">{lockRange}</dd>
        </div>
      </dl>

      {/* actions */}
      <div className="mt-5 flex gap-3">
        <Link href={href} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5" />
          </svg>
          Stake
        </Link>
        <a
          href={explorerAddress(net.l1, vault)}
          target="_blank"
          rel="noreferrer"
          title="View pool contract"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-slate-300 hover:bg-white/10"
        >
          ⋯
        </a>
      </div>
    </div>
  );
}
