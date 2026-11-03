'use client';

import Link from 'next/link';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { TokenIcon } from './TokenIcon';
import { CapacityRing } from './CapacityRing';
import { explorerAddress, poolNet } from '@/config/networks';
import { BaseBadge } from './BaseBadge';
import type { PoolDetail } from '@/lib/vault';
import { pct, statusLabel, summarizePool } from '@/lib/poolSummary';
import { useI18n } from '@/i18n/I18nProvider';
import { fmt, short } from '@/lib/format';
import { useChainNow } from '@/hooks/useChainNow';


export function PoolCard({ vault, onBase, detail: p, asset }: { vault: Address; onBase?: boolean; detail?: PoolDetail; asset?: string }) {
  const { net: root } = useNetwork();
  const net = poolNet(root, onBase);
  const chainNow = useChainNow(net);
  const { t } = useI18n();
  if (!p) return <div className="h-72 animate-pulse rounded-2xl border border-ink-line bg-ink-soft" />;

  const { status, multRange, lockRange, sleeves: all } = summarizePool(p, chainNow);
  const sleeves = all.filter(({ sleeve: s }) => !asset || s.asset.symbol === asset);
  const href = `/pool/?v=${vault}${onBase ? '&c=base' : ''}${asset ? `&asset=${encodeURIComponent(asset)}` : ''}`;

  return (
    <div className="flex flex-col rounded-2xl border border-ink-line bg-ink-soft p-5 transition hover:border-slate-600">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TokenIcon symbol={p.reward.symbol} reward size={40} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-white">{t('common.pool', { sym: p.reward.symbol })}</span>
              {onBase && <BaseBadge />}
              {!p.featured && <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">{t('common.notFeatured')}</span>}
            </div>
            <div className="text-xs text-slate-500">{t('common.partner', { addr: short(p.partner) })}</div>
          </div>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{statusLabel(status, t)}</span>
      </div>

      {/* rewards */}
      <div className="mt-5 space-y-3">
        <div className="text-xs text-slate-500">
          {t('card.rewardHeader', { range: sleeves.length === 1 ? sleeves[0].multRange : multRange })}
        </div>
        {sleeves.map(({ sleeve: s, ref, lo, hi }) => {
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
                  {t('card.perStaked', { amount: fmt(ref, s.asset.decimals), sym: s.asset.symbol })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="my-5 border-t border-ink-line" />

      {/* stats */}
      <dl className="space-y-2.5 text-sm">
        {sleeves.map(({ sleeve: s, filled: ratio }) => {
          return (
            <div key={s.id} className="flex items-center justify-between">
              <dt className="text-slate-400">{t('card.capacity')}{sleeves.length > 1 ? ` · ${s.asset.symbol}` : ''}</dt>
              <dd className="flex items-center gap-2 text-white">
                <CapacityRing ratio={ratio} />
                {pct(ratio)}
              </dd>
            </div>
          );
        })}
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">{t('card.rewardLeft')}</dt>
          <dd className="text-white">
            {fmt(p.available, p.reward.decimals, 0)} {p.reward.symbol}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">{t('card.lock')}</dt>
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
          {t('common.stake')}
        </Link>
        <a
          href={explorerAddress(net.l1, vault)}
          target="_blank"
          rel="noreferrer"
          title={t('card.viewContract')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-slate-300 hover:bg-white/10"
        >
          ⋯
        </a>
      </div>
    </div>
  );
}
