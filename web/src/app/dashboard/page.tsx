'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { myPositions, vaultWrite, type MyPosition } from '@/lib/vault';
import { errorText } from '@/lib/tx';
import { countdown, fmt, fmtDate } from '@/lib/format';
import { useChainNow } from '@/hooks/useChainNow';

const STATUS = ['Active', 'Exit pending', 'Withdrawn'];

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { net } = useNetwork();
  const [positions, setPositions] = useState<MyPosition[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [mounted, setMounted] = useState(false);
  const now = useChainNow(net);
  useEffect(() => setMounted(true), []);

  const load = useCallback(() => {
    if (!address) return;
    myPositions(net, address).then(setPositions, (e) => setError(errorText(e)));
  }, [net, address]);
  useEffect(load, [load]);

  const act = async (p: MyPosition, fn: 'claimReward' | 'withdraw' | 'processExit' | 'exitEarly') => {
    if (!address) return;
    const key = `${p.vault}-${p.id}-${fn}`;
    setBusy(key);
    setError(undefined);
    try {
      await vaultWrite(net, address, p.vault, fn, fn === 'claimReward' ? [[p.id]] : [p.id]);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (!mounted) return null;
  if (!isConnected) {
    return (
      <div className="card flex items-center justify-between">
        <span className="text-sm text-slate-400">Connect your wallet to see your positions.</span>
        <ConnectButton />
      </div>
    );
  }

  const active = positions?.filter((p) => p.status !== 2) ?? [];
  const closed = positions?.filter((p) => p.status === 2) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Your positions</h1>
        <p className="mt-1 text-sm text-slate-400">Rewards accrue every second. Principal comes back in full at unlock.</p>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!positions && <p className="text-sm text-slate-500">Loading…</p>}
      {positions?.length === 0 && (
        <p className="text-sm text-slate-500">
          No positions yet. <Link className="text-mor hover:underline" href="/pools/">Find a pool</Link>.
        </p>
      )}
      {active.map((p) => {
        const unlocked = BigInt(now) >= p.end;
        const elapsed = Math.min(1, Math.max(0, (now - Number(p.start)) / Number(p.end - p.start)));
        const k = (fn: string) => `${p.vault}-${p.id}-${fn}`;
        return (
          <div key={k('')} className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-white">
                  {fmt(p.amount, p.asset.decimals)} {p.asset.symbol} → {fmt(p.reward, p.rewardDecimals)} {p.rewardSymbol}
                </div>
                <Link href={`/pool/?v=${p.vault}`} className="mono text-slate-500 hover:underline">
                  pool {p.vault} · #{p.id.toString()}
                </Link>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${p.status === 1 ? 'bg-amber-500/15 text-amber-300' : 'bg-mor/15 text-mor'}`}>
                {STATUS[p.status]}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-ink">
              <div className="h-full bg-mor" style={{ width: `${elapsed * 100}%` }} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <Stat k="Claimable now" v={`${fmt(p.accrued, p.rewardDecimals)} ${p.rewardSymbol}`} />
              <Stat k="Claimed" v={`${fmt(p.claimed, p.rewardDecimals)} ${p.rewardSymbol}`} />
              <Stat k="Unlock" v={fmtDate(p.end)} />
              <Stat k={unlocked ? 'Status' : 'Time left'} v={unlocked ? 'Unlocked' : countdown(p.end, now)} />
            </dl>
            {p.status === 1 && (
              <p className="text-xs text-amber-300">
                Morpheus did not return the principal yet. Your full balance is recorded; retry below (anyone can, funds only go to you).
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={!!busy || p.accrued === 0n} onClick={() => act(p, 'claimReward')}>
                {busy === k('claimReward') ? 'Confirm in wallet…' : 'Claim reward'}
              </button>
              {p.status === 0 && (
                <button className="btn-primary" disabled={!!busy || !unlocked} onClick={() => act(p, 'withdraw')}>
                  {busy === k('withdraw') ? 'Confirm in wallet…' : unlocked ? 'Withdraw principal + reward' : 'Withdraw at unlock'}
                </button>
              )}
              {p.status === 1 && (
                <button className="btn-primary" disabled={!!busy} onClick={() => act(p, 'processExit')}>
                  {busy === k('processExit') ? 'Confirm in wallet…' : 'Retry exit'}
                </button>
              )}
              {p.status === 0 && p.emergency && !unlocked && (
                <button className="btn-ghost text-amber-300" disabled={!!busy} onClick={() => act(p, 'exitEarly')}>
                  Exit early (keep reward accrued so far)
                </button>
              )}
            </div>
          </div>
        );
      })}
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-slate-400">Withdrawn</h2>
          {closed.map((p) => (
            <div key={`${p.vault}-${p.id}`} className="flex justify-between rounded-lg border border-ink-line px-4 py-2 text-sm text-slate-400">
              <span>
                {fmt(p.amount, p.asset.decimals)} {p.asset.symbol} · #{p.id.toString()}
              </span>
              <span>
                {fmt(p.claimed, p.rewardDecimals)} {p.rewardSymbol} earned
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="text-slate-200">{v}</dd>
    </div>
  );
}
