'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { useNetwork } from './Providers';
import { bridgeInfo, ogBalance, quoteBridge, sendBridge, withoutDust, type BridgeInfo } from '@/lib/bridge';
import type { LzChain } from '@/config/lzChains';
import { errorText } from '@/lib/tx';
import { fmt } from '@/lib/format';
import { useI18n } from '@/i18n/I18nProvider';

/** Sends a Farmer's claimed Alpha Coins to another chain of the bridge, at the same address. Calls the token's own
 * contract; nothing passes through DAT. Renders nothing unless the token came through the bridge kit. */
export function BridgeBack({ token, symbol, onBase, tick }: { token: Address; symbol: string; onBase: boolean; tick?: unknown }) {
  const { net } = useNetwork();
  const { address } = useAccount();
  const { t } = useI18n();
  const [info, setInfo] = useState<BridgeInfo>();
  const [balance, setBalance] = useState<bigint>();
  const [fees, setFees] = useState<Record<number, bigint>>({});
  const [busy, setBusy] = useState<number>();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    bridgeInfo(net, token, onBase).then(setInfo, () => {});
  }, [net, token, onBase]);

  const load = useCallback(async () => {
    if (!info || !address) return;
    const b = withoutDust(await ogBalance(info.here, token, address), 18);
    setBalance(b);
    if (b === 0n) return setFees({});
    const quotes = await Promise.all(info.destinations.map((d) => quoteBridge(info.here, token, d, address, b).then((q) => [d.eid, q.nativeFee] as const)));
    setFees(Object.fromEntries(quotes));
  }, [token, info, address]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, tick]);

  if (!info || !balance) return sent ? <p className="text-xs text-mor">{t('bridge.sent')}</p> : null;

  const send = async (to: LzChain) => {
    setBusy(to.eid);
    setError(undefined);
    setSent(false);
    try {
      await sendBridge(info.here, token, to, address!, balance);
      setSent(true);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-2 text-xs text-slate-400">
      <div>{t('bridge.balance', { amount: fmt(balance, 18), sym: symbol, chain: info.here.name })}</div>
      <div className="flex flex-wrap items-center gap-2">
        {info.destinations.map((d) => (
          <button key={d.eid} className="btn-ghost" disabled={busy !== undefined} onClick={() => send(d)}>
            {busy === d.eid ? t('dash.confirm') : t('bridge.back', { sym: symbol, chain: d.name })}
            {fees[d.eid] !== undefined && <span className="ml-2 text-slate-500">{t('bridge.fee', { fee: Number(formatUnits(fees[d.eid], 18)).toFixed(6) })}</span>}
          </button>
        ))}
      </div>
      {sent && <p className="text-mor">{t('bridge.sent')}</p>}
      {error && <p className="text-red-300">{error}</p>}
    </div>
  );
}
