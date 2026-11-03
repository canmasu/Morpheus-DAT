'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import type { Abi, Address } from 'viem';
import * as A from '@/contracts/artifacts';
import { AdminGate } from '@/components/AdminGate';
import { useNetwork } from '@/components/Providers';
import { baseNet, poolNet, explorerAddress } from '@/config/networks';
import { BaseBadge } from '@/components/BaseBadge';
import { BridgeNote } from '@/components/BridgeNote';
import { contractsFor, listPools, type PoolSummary } from '@/lib/partner';
import { role } from '@/lib/deployPlan';
import { errorText, publicClient, write } from '@/lib/tx';
import { fmt, fmtDate, short } from '@/lib/format';

export default function AdminPoolsPage() {
  return (
    <AdminGate>
      <AdminPools />
    </AdminGate>
  );
}

function AdminPools() {
  const { address } = useAccount();
  const { net } = useNetwork();
  const { factory } = contractsFor(net);
  const [pools, setPools] = useState<(PoolSummary & { onBase: boolean })[]>();
  const [canFeature, setCanFeature] = useState<boolean>();
  const [busy, setBusy] = useState<Address>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!factory || !address) return;
    try {
      const [list, hasRole] = await Promise.all([
        (async () => {
          const base = baseNet(net);
          const baseFactory = base && contractsFor(base).factory;
          const [main, onBase] = await Promise.all([
            listPools(net, factory),
            base && baseFactory ? listPools(base, baseFactory).catch(() => []) : [],
          ]);
          return [...main.map((p) => ({ ...p, onBase: false })), ...onBase.map((p) => ({ ...p, onBase: true }))];
        })(),
        publicClient(net.l1).readContract({
          address: factory,
          abi: A.PoolFactory.abi,
          functionName: 'hasRole',
          args: [role('FEATURER_ROLE'), address],
        }),
      ]);
      setPools(list);
      setCanFeature(hasRole);
    } catch (e) {
      setError(errorText(e));
    }
  }, [net, factory, address]);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (p: PoolSummary & { onBase: boolean }) => {
    if (!factory || !address) return;
    setBusy(p.vault);
    setError(undefined);
    try {
      const here = poolNet(net, p.onBase);
      await write(here.l1, address, contractsFor(here).factory!, A.PoolFactory.abi as Abi, 'setFeatured', [p.vault, !p.featured]);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (!factory) return <p className="card text-sm text-amber-300">Not deployed on {net.label}.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Pools</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Featured pools are listed on /pools. Others stay reachable by direct link with a red &quot;not featured&quot; banner. Feature a
          pool only after reviewing its Partner and reward token, and once its MOR splitter is live.
        </p>
      </div>
      {canFeature === false && (
        <p className="text-sm text-amber-300">This wallet does not hold FEATURER_ROLE on the factory, so it cannot change featured flags.</p>
      )}
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!pools && <p className="text-sm text-slate-500">Loading…</p>}
      {pools?.length === 0 && <p className="text-sm text-slate-500">No pools yet.</p>}
      <div className="space-y-3">
        {pools?.map((p) => (
          <div key={p.vault} className="card flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="font-medium text-white">
                {p.rewardSymbol} pool {p.onBase && <BaseBadge />}
                {p.featured ? (
                  <span className="ml-2 rounded bg-mor/15 px-2 py-0.5 text-xs text-mor">featured</span>
                ) : (
                  <span className="ml-2 rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">not featured</span>
                )}
              </div>
              <div className="mono text-slate-500">
                <a className="hover:underline" href={explorerAddress(poolNet(net, p.onBase).l1, p.vault)} target="_blank" rel="noreferrer">
                  {p.vault}
                </a>
              </div>
              <div className="text-xs text-slate-400">
                Partner {short(p.partner)} · reward token {short(p.rewardToken)} · capacity {fmt(p.available, p.rewardDecimals)} {p.rewardSymbol}{' '}
                · {p.positions.toString()} positions · deposits {fmtDate(p.depositStart)} → {fmtDate(p.depositEnd)}
              </div>
              <BridgeNote token={p.rewardToken} onBase={p.onBase} className="text-xs" />
              <div className={`text-xs ${p.splitterLive ? 'text-mor' : 'text-red-400'}`}>
                {p.splitterLive ? '✓ MOR splitter live' : '✗ MOR splitter not deployed: MOR would go to an empty address'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link className="text-xs text-slate-400 hover:text-mor" href={`/pool/?v=${p.vault}`}>
                view
              </Link>
              <button
                className={p.featured ? 'btn-ghost' : 'btn-primary'}
                disabled={!!busy || !canFeature || (!p.featured && !p.splitterLive)}
                title={!p.featured && !p.splitterLive ? 'Deploy the MOR splitter first' : undefined}
                onClick={() => toggle(p)}
              >
                {busy === p.vault ? 'Confirm in wallet…' : p.featured ? 'Unfeature' : 'Feature'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
