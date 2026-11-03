'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNetwork } from '@/components/Providers';
import { PoolCard } from '@/components/PoolCard';
import { PoolTable } from '@/components/PoolTable';
import { load, remove, save } from '@/lib/storage';
import { useI18n } from '@/i18n/I18nProvider';
import { allPoolsEverywhere, readPool, type PoolDetail, type PoolRef } from '@/lib/vault';
import { contractsFor } from '@/lib/partner';
import { baseNet, poolNet } from '@/config/networks';
import { TokenIcon } from '@/components/TokenIcon';
import { errorText } from '@/lib/tx';

export default function PoolsPage() {
  const { net } = useNetwork();
  const { t } = useI18n();
  const [pools, setPools] = useState<PoolRef[]>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [details, setDetails] = useState<Record<string, PoolDetail>>({});
  const [asset, setAsset] = useState<string>();
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    const v = fromUrl ?? load<'cards' | 'table'>('dat-pools-view');
    if (v === 'cards' || v === 'table') setView(v);
    setAsset(new URLSearchParams(window.location.search).get('asset') ?? load<string>('dat-pools-asset') ?? undefined);
  }, []);
  const choose = (v: 'cards' | 'table') => {
    setView(v);
    save('dat-pools-view', v);
  };
  const chooseAsset = (a?: string) => {
    setAsset(a);
    if (a) save('dat-pools-asset', a);
    else remove('dat-pools-asset');
  };
  useEffect(() => {
    setPools(undefined);
    setDetails({});
    allPoolsEverywhere(net).then(
      (list) => {
        setPools(list);
        // Each pool appears as soon as it loads; one failing read hides only that pool.
        for (const p of list) {
          readPool(poolNet(net, p.onBase), p.vault).then((d) => setDetails((cur) => ({ ...cur, [p.vault]: d })), () => {});
        }
      },
      (e) => setError(errorText(e)),
    );
  }, [net]);

  const base = baseNet(net);
  const assets = [...net.stakeAssets, ...(base && contractsFor(base).factory ? base.stakeAssets : [])].map((a) => a.symbol).join(' / ');
  // Docs rule: non-featured pools are never listed on mainnet, only reachable by direct link.
  const listed = pools?.filter((p) => p.featured || net.name === 'testnet') ?? [];
  // The filter offers only coins some listed pool accepts, and falls back to All if the chosen one is gone.
  const coins = [...new Set(listed.flatMap((p) => details[p.vault]?.sleeves.map((s) => s.asset.symbol) ?? []))];
  const active = asset && coins.includes(asset) ? asset : undefined;
  // A pool still loading stays as a placeholder, so the list does not jump when it arrives.
  const shown = listed.filter((p) => !active || !details[p.vault] || details[p.vault].sleeves.some((s) => s.asset.symbol === active));
  const featured = shown.filter((p) => p.featured);
  const others = shown.filter((p) => !p.featured);

  const list = (items: PoolRef[]) =>
    view === 'table' ? (
      <PoolTable pools={items.map((p) => ({ ...p, detail: details[p.vault] }))} asset={active} />
    ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((p) => (
          <PoolCard key={p.vault} vault={p.vault} onBase={p.onBase} detail={details[p.vault]} asset={active} />
        ))}
      </div>
    );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
        <h1 className="text-2xl font-semibold text-white">{t('pools.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t('pools.sub', { assets })}
        </p>
        </div>
        <ViewToggle view={view} onChange={choose} labels={[t('view.cards'), t('view.table')]} />
      </div>
      {coins.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('filter.label')}>
          {[undefined, ...coins].map((c) => (
            <button
              key={c ?? 'all'}
              onClick={() => chooseAsset(c)}
              aria-pressed={active === c}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${active === c ? 'border-mor bg-mor/10 text-white' : 'border-ink-line text-slate-300 hover:border-slate-500'}`}
            >
              {c && <TokenIcon symbol={c} size={18} />}
              {c ?? t('filter.all')}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!pools && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {pools && featured.length === 0 && <p className="text-sm text-slate-500">{t('pools.noFeatured')}</p>}
      {featured.length > 0 && list(featured)}
      {others.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-amber-300">{t('pools.notFeaturedTestnet')}</h2>
          {list(others)}
        </section>
      )}
      <p className="text-xs text-slate-500">
        {t('pools.partnersCta')}{' '}
        <Link className="text-mor hover:underline" href="/partner/create/">
          {t('pools.createPool')}
        </Link>
      </p>
    </div>
  );
}

function ViewToggle({ view, onChange, labels }: { view: 'cards' | 'table'; onChange: (v: 'cards' | 'table') => void; labels: [string, string] }) {
  const btn = (v: 'cards' | 'table', label: string, icon: React.ReactNode) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-ink-soft text-white' : 'text-slate-400 hover:text-slate-200'}`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex gap-1 rounded-xl border border-ink-line bg-ink p-1">
      {btn(
        'cards',
        labels[0],
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>,
      )}
      {btn(
        'table',
        labels[1],
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>,
      )}
    </div>
  );
}
