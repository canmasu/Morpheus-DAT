'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { AdminGate } from '@/components/AdminGate';
import { useNetwork } from '@/components/Providers';
import { TokenIcon } from '@/components/TokenIcon';
import { explorerAddress } from '@/config/networks';
import { claimReferralMor, readStatus, type MorpheusStatus } from '@/lib/status';
import { errorText } from '@/lib/tx';
import { fmt, short } from '@/lib/format';

const dur = (s?: bigint) => {
  if (s === undefined) return '—';
  const n = Number(s);
  return n >= 86400 ? `${+(n / 86400).toFixed(1)} days` : n >= 3600 ? `${+(n / 3600).toFixed(1)} h` : n >= 60 ? `${+(n / 60).toFixed(1)} min` : `${n} s`;
};

export default function HealthPage() {
  return (
    <AdminGate>
      <Health />
    </AdminGate>
  );
}

function Health() {
  const { net } = useNetwork();
  const { address } = useAccount();
  const [st, setSt] = useState<MorpheusStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = useCallback(() => {
    setSt(undefined);
    readStatus(net).then(setSt, (e) => setError(errorText(e)));
  }, [net]);
  useEffect(load, [load]);

  const isReferral = !!st?.dat && !!address && st.dat.referral.toLowerCase() === address.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Admin
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-white">Morpheus status</h1>
          <p className="mt-1 text-sm text-slate-400">{net.label} · live reads from Morpheus Capital and the DAT factory</p>
        </div>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!st && !error && <p className="text-sm text-slate-500">Reading…</p>}

      {st && (
        <>
          {/* headline checks */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Check
              ok={st.lz.ok}
              title="MOR claims"
              good={`Working · fee ~${st.lz.fee !== undefined ? fmt(st.lz.fee, 18, 5) : '?'} ETH`}
              bad={st.lz.adapterParams === '0x' ? 'Blocked: Morpheus LayerZero settings empty' : 'Blocked: fee quote fails'}
            />
            <Check
              ok={st.assets.every((a) => a.healthy)}
              title="New stakes"
              good="Morpheus matches the recorded baseline"
              bad={`Halted for ${st.assets.filter((a) => !a.healthy).map((a) => a.asset.symbol).join(', ')}: Morpheus changed`}
            />
            <Check
              ok={!!st.dat && !st.dat.depositsPaused && !st.dat.allPaused}
              title="DAT pause"
              good="Not paused"
              bad={st.dat?.allPaused ? 'Everything paused (withdrawals still open)' : 'Deposits paused'}
            />
            <Check ok={!!st.dat && !st.dat.exitOnly} title="Adapter" good="Normal adapter in use" bad="Exit-only adapter in use" />
          </section>

          {/* per asset */}
          <section className="rounded-2xl border border-ink-line bg-ink-soft p-5">
            <h2 className="mb-4 font-medium text-white">Morpheus Capital pools</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="pb-2 text-left font-normal">Asset</th>
                    <th className="pb-2 text-right font-normal">Version</th>
                    <th className="pb-2 text-right font-normal">Withdraw lock</th>
                    <th className="pb-2 text-right font-normal">Claim lock (stake)</th>
                    <th className="pb-2 text-right font-normal">Claim lock (claim)</th>
                    <th className="pb-2 text-right font-normal">Min stake</th>
                    <th className="pb-2 text-right font-normal">Baseline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-line text-slate-200">
                  {st.assets.map((a) => (
                    <tr key={a.asset.symbol}>
                      <td className="py-2.5">
                        <a className="flex items-center gap-2 hover:underline" href={explorerAddress(net.l1, a.asset.depositPool)} target="_blank" rel="noreferrer">
                          <TokenIcon symbol={a.asset.symbol} size={22} />
                          {a.asset.symbol}
                        </a>
                      </td>
                      {a.error ? (
                        <td colSpan={6} className="py-2.5 text-right text-red-300">
                          {a.error}
                        </td>
                      ) : (
                        <>
                          <td className="py-2.5 text-right">{a.version?.toString()}</td>
                          <td className="py-2.5 text-right">{dur(a.live?.withdrawLock)}</td>
                          <td className="py-2.5 text-right">{dur(a.live?.claimLockAfterStake)}</td>
                          <td className="py-2.5 text-right">{dur(a.live?.claimLockAfterClaim)}</td>
                          <td className="py-2.5 text-right">{a.live ? fmt(a.live.minimalStake, a.asset.decimals, 6) : '—'}</td>
                          <td className={`py-2.5 text-right ${a.healthy ? 'text-mor' : 'text-red-300'}`}>{a.healthy ? '✓ matches' : '✗ changed'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              &quot;Changed&quot; blocks new stakes until the multisig fork-tests the change and calls recordBaseline on the adapter. Exits keep
              working.
            </p>
          </section>

          {/* LayerZero */}
          <section className="rounded-2xl border border-ink-line bg-ink-soft p-5 text-sm">
            <h2 className="mb-3 font-medium text-white">LayerZero (MOR to {net.l2.name})</h2>
            <dl className="space-y-1.5">
              <Row k="Morpheus L1Sender">
                <a className="mono hover:underline" href={explorerAddress(net.l1, net.morpheus.l1Sender)} target="_blank" rel="noreferrer">
                  {short(net.morpheus.l1Sender)} ↗
                </a>
              </Row>
              <Row k="adapterParams">
                <span className={`mono ${st.lz.adapterParams === '0x' ? 'text-red-300' : ''}`}>
                  {st.lz.adapterParams === undefined ? '—' : st.lz.adapterParams === '0x' ? '0x (empty)' : short(st.lz.adapterParams)}
                </span>
              </Row>
              <Row k="Fee per MOR claim">{st.lz.fee !== undefined ? `${fmt(st.lz.fee, 18, 6)} ETH` : 'quote fails'}</Row>
            </dl>
            {!st.lz.ok && (
              <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
                Every MOR claim reverts until the Morpheus owner sets adapterParams on the L1Sender (mainnet uses
                0x0001…03d090). This box turns green by itself once they do.
              </p>
            )}
          </section>

          {/* DAT settings + referral */}
          {st.dat && (
            <section className="rounded-2xl border border-ink-line bg-ink-soft p-5 text-sm">
              <h2 className="mb-3 font-medium text-white">DAT settings and referral MOR</h2>
              <dl className="space-y-1.5">
                <Row k="DAT fee">{(st.dat.feeBps / 100).toFixed(1)}%</Row>
                <Row k="Fee wallet">{short(st.dat.feeWallet)}</Row>
                <Row k="Morpheus referrer (DAT referral wallet)">{short(st.dat.referral)}</Row>
                {st.assets.map((a) => (
                  <Row key={a.asset.symbol} k={`Referral MOR pending · ${a.asset.symbol}`}>
                    <span className="flex items-center gap-3">
                      {a.referralPending !== undefined ? `${fmt(a.referralPending, 18, 6)} MOR` : '—'}
                      {isReferral && (
                        <button
                          className="btn-ghost px-3 py-1 text-xs"
                          disabled={!!busy || !st.lz.ok || !a.referralPending}
                          onClick={async () => {
                            setBusy(a.asset.symbol);
                            setNote(undefined);
                            setError(undefined);
                            try {
                              await claimReferralMor(net, address!, a.asset, st.dat!.referral, st.lz.fee!);
                              setNote(`Referral MOR claimed; it arrives on ${net.l2.name} in a few minutes.`);
                              load();
                            } catch (e) {
                              setError(errorText(e));
                            } finally {
                              setBusy(undefined);
                            }
                          }}
                        >
                          {busy === a.asset.symbol ? 'Confirm…' : 'Claim'}
                        </button>
                      )}
                    </span>
                  </Row>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-500">
                Morpheus pays referral MOR to the referrer wallet set on every DAT stake. Only that wallet can claim it
                {isReferral ? '.' : `; connect ${short(st.dat.referral)} to claim.`}
              </p>
              {note && <p className="mt-2 text-xs text-mor">{note}</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Check({ ok, title, good, bad }: { ok: boolean; title: string; good: string; bad: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${ok ? 'border-mor/30 bg-mor/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-mor' : 'bg-red-400'}`} />
        {title}
      </div>
      <div className={`mt-1 text-xs ${ok ? 'text-slate-400' : 'text-red-300'}`}>{ok ? good : bad}</div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-200">{children}</dd>
    </div>
  );
}
