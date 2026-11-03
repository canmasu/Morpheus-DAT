'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useEffect, useState } from 'react';
import { short } from '@/lib/format';
import { useI18n } from '@/i18n/I18nProvider';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <button className="btn-ghost">{t('wallet.connect')}</button>;

  if (isConnected && address) {
    return (
      <button className="btn-ghost mono" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error.message.split('\n')[0]}</span>}
      <button className="btn-primary" disabled={isPending || !injected} onClick={() => connect({ connector: injected })}>
        {isPending ? t('wallet.connecting') : t('wallet.connect')}
      </button>
    </div>
  );
}
