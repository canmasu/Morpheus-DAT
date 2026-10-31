'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import { useNetwork } from './Providers';
import { useChainNow } from '@/hooks/useChainNow';
import { explorerAddress } from '@/config/networks';
import { accountsMor, claimMor, distributeMor, morBalances, quoteMorClaimFee, sandboxSendMor, type AccountMor } from '@/lib/mor';
import { errorText } from '@/lib/tx';
import { countdown, fmt, fmtDate, short } from '@/lib/format';

/** MOR for one pool: claim from Morpheus per Capital Account (Ethereum), then split on Arbitrum. */
export function MorPanel({ vault, splitter, partner, splitterLive }: { vault: Address; splitter: Address; partner: Address; splitterLive: boolean }) {
  const { net } = useNetwork();
  const { address } = useAccount();
  const now = BigInt(useChainNow(net));
  const [accounts, setAccounts] = useState<AccountMor[]>();
  const [fee, setFee] = useState<bigint>();
  const [feeError, setFeeError] = useState<string>();
  const [bal, setBal] = useState<{ inSplitter: bigint; partnerMor: bigint }>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = useCallback(async () => {
    try {
      setAccounts(await accountsMor(net, vault));
      if (splitterLive) setBal(await morBalances(net, splitter, partner));
    } catch (e) {
      setError(errorText(e));
    }
    quoteMorClaimFee(net).then(
      (f) => {
        setFee(f);
        setFeeError(undefined);
      },
      () => setFeeError('unavailable'),
    );
  }, [net, vault, splitter, partner, splitterLive]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    if (!address) return;
    setBusy(key);
    setError(undefined);
    setNote(undefined);
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-ink-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-white">MOR</h3>
        <span className="text-xs text-slate-500">
          1 · claim from Morpheus on {net.l1.name} → 2 · LayerZero mints to the splitter on {net.l2.name} → 3 · distribute
        </span>
      </div>

      {feeError && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
          {net.name === 'testnet'
            ? "Morpheus's Sepolia deployment cannot send MOR right now: its LayerZero settings are empty, so every MOR claim reverts (InvalidWorkerOptions). Only the Morpheus team can fix it. On mainnet this path works."
            : 'Could not quote the LayerZero fee from Morpheus. MOR claims may fail until this is resolved.'}
        </p>
      )}

      <div>
        <h4 className="label">1 · Claim per Capital Account</h4>
        {!accounts && <p className="text-xs text-slate-500">Loading…</p>}
        {accounts?.length === 0 && <p className="text-xs text-slate-500">No stakes yet, so nothing earns MOR.</p>}
        <ul className="divide-y divide-ink-line">
          {accounts?.map((a) => {
            const locked = now < a.claimableAt;
            const boosted = a.boostedUntil > now;
            return (
              <li key={a.account} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div className="space-y-0.5">
                  <div className="text-slate-300">
                    {a.symbol} · epoch {a.epochId} · lock #{a.lockOptionId} · {fmt(a.deposited, a.decimals)} in Morpheus{' '}
                    <a className="mono text-slate-500 hover:underline" href={explorerAddress(net.l1, a.account)} target="_blank" rel="noreferrer">
                      {short(a.account)}
                    </a>
                  </div>
                  <div className="text-slate-500">
                    {!a.inMorpheus
                      ? 'Pulled out of Morpheus: no more MOR'
                      : locked
                        ? boosted
                          ? `MOR boost: claim locked until ${fmtDate(a.boostedUntil)} (${countdown(a.claimableAt, Number(now))})`
                          : `Morpheus claim lock: claimable in ${countdown(a.claimableAt, Number(now))}`
                        : `Claimable now${a.pending > 0n ? ` · about ${fmt(a.pending, 18)} MOR pending` : ''}`}
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  disabled={!!busy || !address || !a.inMorpheus || locked || fee === undefined}
                  onClick={() =>
                    act(a.account, () => claimMor(net, address!, vault, a, fee!), `Claim sent. MOR reaches the splitter on ${net.l2.name} in a few minutes.`)
                  }
                >
                  {busy === a.account ? 'Confirm in wallet…' : `Claim MOR${fee !== undefined ? ` (fee ~${fmt(fee, 18, 5)} ETH)` : ''}`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h4 className="label">2–3 · Splitter on {net.l2.name}</h4>
        {!splitterLive ? (
          <p className="text-xs text-red-400">Splitter not deployed yet.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="space-y-0.5 text-slate-300">
              <div>
                Waiting in splitter: <span className="text-white">{bal ? fmt(bal.inSplitter, 18) : '…'} MOR</span>
              </div>
              <div className="text-slate-500">
                Partner {short(partner)} holds {bal ? fmt(bal.partnerMor, 18) : '…'} MOR on {net.l2.name}
              </div>
            </div>
            <div className="flex gap-2">
              {net.name === 'local' && (
                <button
                  className="btn-ghost"
                  disabled={!!busy || !address}
                  onClick={() => act('sim', () => sandboxSendMor(net, address!, splitter, parseUnits('100', 18)), 'Sandbox: 100 MOR arrived at the splitter.')}
                >
                  Sandbox: simulate 100 MOR arriving
                </button>
              )}
              <button
                className="btn-primary"
                disabled={!!busy || !address || !bal || bal.inSplitter === 0n}
                onClick={() => act('dist', () => distributeMor(net, address!, splitter), 'Distributed: Partner and DAT fee wallet paid.')}
              >
                {busy === 'dist' ? 'Confirm in wallet…' : 'Distribute to Partner + DAT fee'}
              </button>
            </div>
          </div>
        )}
      </div>

      {note && <p className="text-xs text-mor">{note}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
