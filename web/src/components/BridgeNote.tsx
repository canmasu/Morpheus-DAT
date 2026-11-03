'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from './Providers';
import { bridgeInfo, type BridgeInfo } from '@/lib/bridge';
import { useI18n } from '@/i18n/I18nProvider';

/** Shown on pools whose Alpha Coin came through the bridge kit. The settings are read live from the chains. */
export function BridgeNote({ token, onBase, className = '' }: { token: Address; onBase: boolean; className?: string }) {
  const { net } = useNetwork();
  const { t } = useI18n();
  const [info, setInfo] = useState<BridgeInfo>();
  useEffect(() => {
    setInfo(undefined);
    bridgeInfo(net, token, onBase).then(setInfo, () => {});
  }, [net, token, onBase]);
  if (!info) return null;

  const chain = info.home.name;
  const safeSetup = info.linked && info.verifiers >= 2;
  const [tone, text] = !safeSetup
    ? ['border-red-500/30 bg-red-500/10 text-red-300', t('bridge.warnSetup', { chain })]
    : !info.ownerIsContract
      ? ['border-amber-400/30 bg-amber-400/10 text-amber-300', t('bridge.warnOwner', { chain })]
      : !info.allChecked
        ? ['border-amber-400/30 bg-amber-400/10 text-amber-300', t('bridge.warnUnchecked', { chain, here: info.here.name })]
        : ['border-ink-line bg-ink-soft text-slate-300', t('bridge.ok', { chain, n: info.verifiers })];
  return <p className={`rounded-xl border p-3 text-sm ${tone} ${className}`}>{text}</p>;
}
