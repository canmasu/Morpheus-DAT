'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { MorPanel } from '@/components/MorPanel';
import { BuilderMorPanel } from '@/components/BuilderMorPanel';
import { BaseBadge } from '@/components/BaseBadge';
import { baseNet, explorerAddress, poolNet } from '@/config/networks';
import { contractsFor, deploySplitter, listPools, type PoolSummary } from '@/lib/partner';
import { errorText } from '@/lib/tx';
import { short } from '@/lib/format';

const fmtDate = (s: bigint) => new Date(Number(s) * 1000).toLocaleString();
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function PartnerPage() {
  const { address, isConnected } = useAccount();
  const { net } = useNetwork();
  const { factory } = contractsFor(net);
  const [pools, setPools] = useState<(PoolSummary & { onBase: boolean })[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const refresh = useCallback(async () => {
    if (!factory || !address) return;
    try {
      const base = baseNet(net);
      const baseFactory = base && contractsFor(base).factory;
      const [main, onBase] = await Promise.all([
        listPools(net, factory, address),
        base && baseFactory ? listPools(base, baseFactory, address).catch(() => []) : [],
      ]);
      setPools([...main.map((p) => ({ ...p, onBase: false })), ...onBase.map((p) => ({ ...p, onBase: true }))]);
    } catch (e) {
      setError(errorText(e));
    }
  }, [net, factory, address]);

  useEffect(() => {
    setPools(undefined);
    refresh();
  }, [refresh]);

  const fixSplitter = async (vault: Address, onBase: boolean) => {
    const here = poolNet(net, onBase);
    const c = contractsFor(here);
    if (!c.factory || !c.splitterDeployer || !address) return;
    setBusy(vault);
    setError(undefined);
    try {
      await deploySplitter(here, address, c.factory, c.splitterDeployer, vault);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-mor">Partners</p>
          <h1 className="text-2xl font-semibold text-white">Fund a pool with your token. Receive MOR.</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Farmers put {net.stakeAssets.map((a) => a.symbol).join(' or ')} in your pool and receive your token. The yield on their staked
            tokens earns MOR for you on {net.l2.name}, minus the DAT fee. Pools on Base take MOR through your own Morpheus Builders subnet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/partner/bridge/" className="btn-ghost">
            Bring a token from another chain
          </Link>
          <Link href="/partner/create/" className="btn-primary">
            Create a pool
          </Link>
        </div>
      </div>

      {!factory && <p className="card text-sm text-amber-300">Morpheus DAT is not deployed on this network yet.</p>}
      {mounted && !isConnected && (
        <div className="card flex items-center justify-between">
          <span className="text-sm text-slate-400">Connect your wallet to see your pools.</span>
          <ConnectButton />
        </div>
      )}
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {mounted && isConnected && factory && (
        <section className="space-y-3">
          <h2 className="font-medium text-white">Your pools</h2>
          {!pools && <p className="text-sm text-slate-500">Loading…</p>}
          {pools?.length === 0 && <p className="text-sm text-slate-500">No pools yet.</p>}
          {pools?.map((p) => {
            const here = poolNet(net, p.onBase);
            return (
            <div key={p.vault} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-white">
                    {p.rewardSymbol} pool{' '}
                    {p.onBase && <BaseBadge />}
                    {p.featured ? (
                      <span className="ml-2 rounded bg-mor/15 px-2 py-0.5 text-xs text-mor">featured</span>
                    ) : (
                      <span className="ml-2 rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">not featured</span>
                    )}
                  </div>
                  <a className="mono text-slate-500 hover:underline" href={explorerAddress(here.l1, p.vault)} target="_blank" rel="noreferrer">
                    {p.vault}
                  </a>
                  <Link className="ml-3 text-xs text-mor hover:underline" href={`/pool/?v=${p.vault}${p.onBase ? '&c=base' : ''}`}>
                    Open stake page →
                  </Link>
                </div>
                {p.splitterLive ? (
                  <span className="text-xs text-mor">✓ MOR splitter live on {here.l2.name}</span>
                ) : (
                  <button className="btn-primary" disabled={!!busy} onClick={() => fixSplitter(p.vault, p.onBase)}>
                    {busy === p.vault ? 'Waiting for wallet…' : `Deploy MOR splitter on ${here.l2.name}`}
                  </button>
                )}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-4">
                <Stat k="Unreserved budget" v={`${fmt(p.available, p.rewardDecimals)} ${p.rewardSymbol}`} />
                <Stat k="Reserved for farmers" v={`${fmt(p.committed, p.rewardDecimals)} ${p.rewardSymbol}`} />
                <Stat k="Deposits" v={`${fmtDate(p.depositStart)} → ${fmtDate(p.depositEnd)}`} />
                <Stat k="Positions" v={p.positions.toString()} />
              </dl>
              {p.onBase ? (
                <BuilderMorPanel vault={p.vault} splitter={p.morReceiver} partner={p.partner} splitterLive={p.splitterLive} />
              ) : (
                <MorPanel vault={p.vault} splitter={p.morReceiver} partner={p.partner} splitterLive={p.splitterLive} />
              )}
              <p className="text-xs text-slate-500">
                MOR receiver:{' '}
                <a className="mono hover:underline" href={explorerAddress(here.l2, p.morReceiver)} target="_blank" rel="noreferrer">
                  {short(p.morReceiver)}
                </a>
              </p>
            </div>
            );
          })}
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
