'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { BaseBadge } from './BaseBadge';
import { poolNet } from '@/config/networks';
import { TokenIcon } from './TokenIcon';
import { CapacityRing } from './CapacityRing';
import type { PoolDetail } from '@/lib/vault';
import { pct, statusLabel, summarizePool } from '@/lib/poolSummary';
import { useI18n } from '@/i18n/I18nProvider';
import { fmt, fmtCompact, short } from '@/lib/format';
import { useChainNow } from '@/hooks/useChainNow';

type PoolView = { vault: Address; onBase: boolean; detail?: PoolDetail };

/** One row per stake coin. The Pool column stays pinned; the rest scrolls sideways on small screens. */
export function PoolTable({ pools, asset }: { pools: PoolView[]; asset?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    el?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, pools.length]);

  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  const scrollable = edges.left || edges.right;

  return (
    <div className="relative rounded-2xl border border-ink-line bg-ink-soft">
      {scrollable && (
        <div className="absolute right-3 top-2.5 z-20 flex gap-1 rounded-full bg-ink-soft/95 p-0.5 shadow">
          <button aria-label={t('table.scrollLeft')} disabled={!edges.left} onClick={() => nudge(-1)} className="h-7 w-7 rounded-full text-slate-300 hover:bg-white/5 disabled:opacity-30">
            ‹
          </button>
          <button aria-label={t('table.scrollRight')} disabled={!edges.right} onClick={() => nudge(1)} className="h-7 w-7 rounded-full text-slate-300 hover:bg-white/5 disabled:opacity-30">
            ›
          </button>
        </div>
      )}
      <div ref={scroller} className="overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className={`sticky left-0 z-10 bg-ink-soft py-4 pl-4 pr-4 font-medium md:pl-5 ${edges.left ? 'shadow-[6px_0_8px_-6px_rgba(0,0,0,0.6)]' : ''}`}>{t('col.pool')}</th>
              <th className="py-4 pr-4 font-medium">{t('col.reward')}</th>
              <th className="py-4 pr-4 font-medium">{t('col.mult')}</th>
              <th className="py-4 pr-4 font-medium">{t('col.capacity')}</th>
              <th className="py-4 pr-4 font-medium">{t('col.left')}</th>
              <th className="py-4 pr-4 font-medium">{t('col.lock')}</th>
              <th className={`py-4 font-medium ${scrollable ? 'pr-20' : 'pr-5'}`}>{t('col.status')}</th>
              <th className="py-4 pr-5" />
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              p.detail ? <PoolRows key={p.vault} pool={p} detail={p.detail} asset={asset} pinnedShadow={edges.left} /> : <Skeleton key={p.vault} />
            ))}
          </tbody>
        </table>
      </div>
      {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-ink-soft to-transparent" />}
    </div>
  );
}

function Skeleton() {
  return (
    <tr>
      <td colSpan={8} className="border-t border-ink-line px-5 py-5">
        <div className="h-8 animate-pulse rounded bg-white/5" />
      </td>
    </tr>
  );
}

/** One row per stake coin of a pool, or only the filtered coin. */
function PoolRows({ pool, detail: p, asset, pinnedShadow }: { pool: PoolView; detail: PoolDetail; asset?: string; pinnedShadow: boolean }) {
  const { net: root } = useNetwork();
  const net = poolNet(root, pool.onBase);
  const router = useRouter();
  const chainNow = useChainNow(net);
  const { t } = useI18n();
  const cell = 'border-t border-ink-line py-4 pr-4 align-middle';
  const { status, lockRange, sleeves } = summarizePool(p, chainNow);

  return (
    <>
      {sleeves
        .filter(({ sleeve: s }) => !asset || s.asset.symbol === asset)
        .map(({ sleeve: s, ref, lo, hi, filled, multRange }) => {
          const href = `/pool/?v=${pool.vault}${pool.onBase ? '&c=base' : ''}&asset=${encodeURIComponent(s.asset.symbol)}`;
          return (
            <tr key={s.id} className="group cursor-pointer hover:bg-white/[0.02]" onClick={() => router.push(href)}>
              <td className={`${cell} sticky left-0 z-10 min-w-[170px] bg-ink-soft pl-4 md:pl-5 group-hover:bg-ink-hover ${pinnedShadow ? 'shadow-[6px_0_8px_-6px_rgba(0,0,0,0.6)]' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex shrink-0 items-center" title={`${s.asset.symbol} → ${p.reward.symbol}`}>
                    <TokenIcon symbol={s.asset.symbol} size={32} />
                    <span className="-ml-2 rounded-full ring-2 ring-ink-soft">
                      <TokenIcon symbol={p.reward.symbol} reward size={32} />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 whitespace-nowrap font-medium text-white">
                      {t('common.pool', { sym: p.reward.symbol })}
                      {pool.onBase && <BaseBadge />}
                      {!p.featured && <span className="rounded bg-red-500/15 px-1 text-[10px] font-normal text-red-300">{t('common.notFeatured')}</span>}
                    </div>
                    <div className="whitespace-nowrap text-xs text-slate-500">{t('common.partner', { addr: short(p.partner) })}</div>
                  </div>
                </div>
              </td>
              <td className={`${cell} whitespace-nowrap`}>
                <span className="text-white">
                  {fmt(lo, p.reward.decimals)}
                  {hi !== lo && ` – ${fmt(hi, p.reward.decimals)}`}
                </span>{' '}
                <span className="text-xs text-slate-500">
                  {p.reward.symbol} / {fmtCompact(ref, s.asset.decimals)} {s.asset.symbol}
                </span>
              </td>
              <td className={`${cell} whitespace-nowrap text-white`}>{multRange}</td>
              <td className={cell}>
                <div className="flex items-center gap-2 whitespace-nowrap text-white">
                  <CapacityRing ratio={filled} size={16} />
                  {pct(filled)}
                </div>
              </td>
              <td className={`${cell} whitespace-nowrap text-white`}>
                {fmtCompact(p.available, p.reward.decimals)} <span className="text-xs text-slate-500">{p.reward.symbol}</span>
              </td>
              <td className={`${cell} whitespace-nowrap text-white`}>{lockRange}</td>
              <td className={cell}>
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{statusLabel(status, t)}</span>
              </td>
              <td className={`${cell} pr-5 text-right`}>
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                >
                  {t('common.stake')}
                </Link>
              </td>
            </tr>
          );
        })}
    </>
  );
}
