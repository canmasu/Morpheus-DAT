'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { baseNet } from '@/config/networks';
import { claimSubnetMor, subnetStatus, type SubnetStatus } from '@/lib/partner';
import { distributeMor, morBalances } from '@/lib/mor';
import { errorText } from '@/lib/tx';
import { fmt, short } from '@/lib/format';
import { useI18n } from '@/i18n/I18nProvider';

type Props = { vault: Address; splitter: Address; partner: Address; splitterLive: boolean };

/** MOR of a Base pool: its Builders subnet earns it, the pool claims it to the splitter, the splitter pays out. */
export function BuilderMorPanel({ vault, splitter, partner, splitterLive }: Props) {
  const { net: root } = useNetwork();
  const net = baseNet(root)!;
  const { address } = useAccount();
  const { t } = useI18n();
  const [subnet, setSubnet] = useState<SubnetStatus>();
  const [bal, setBal] = useState<Awaited<ReturnType<typeof morBalances>>>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    subnetStatus(net, vault).then(setSubnet, (e) => setError(errorText(e)));
    morBalances(net, splitter, partner).then(setBal, () => {});
  }, [net, vault, splitter, partner]);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const slug = subnet?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <div className="space-y-3 rounded-xl border border-ink-line p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-white">{t('builder.title')}</h3>
        {subnet && net.name === 'mainnet' && (
          <a
            className="text-xs text-mor hover:underline"
            href={`https://dashboard.mor.org/builders/${slug}?subnet_id=${subnet.id}&network=Base`}
            target="_blank"
            rel="noreferrer"
          >
            {t('builder.onMorpheus', { name: subnet.name })}
          </a>
        )}
      </div>
      {subnet && (
        <p className="text-xs text-slate-500">
          {subnet.name} · <span className="mono">{short(subnet.id)}</span> · {t('builder.staked', { amount: fmt(subnet.deposited, 18) })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{t('builder.earned')}</div>
          <div className="text-slate-200">{subnet ? `${fmt(subnet.pending, 18)} MOR` : '…'}</div>
        </div>
        <button
          className="btn-ghost"
          disabled={!address || !!busy || !subnet || subnet.pending === 0n}
          onClick={() => act('claim', () => claimSubnetMor(net, address!, vault))}
        >
          {busy === 'claim' ? t('dash.confirm') : t('builder.claim')}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{t('builder.ready')}</div>
          <div className="text-slate-200">{bal ? `${fmt(bal.inSplitter, 18)} MOR` : '…'}</div>
          <div className="text-xs text-slate-500">
            {t('builder.feeThen')}{bal ? ` · ${t('mor.partnerHolds', { addr: short(partner), amount: fmt(bal.partnerMor, 18), chain: net.l2.name })}` : ''}
          </div>
        </div>
        <button
          className="btn-ghost"
          disabled={!address || !!busy || !splitterLive || !bal || bal.inSplitter === 0n}
          onClick={() => act('split', () => distributeMor(net, address!, splitter))}
        >
          {busy === 'split' ? t('dash.confirm') : t('builder.payout')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
