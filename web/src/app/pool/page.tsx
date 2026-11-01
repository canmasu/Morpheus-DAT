'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { erc20Abi, isAddress, parseUnits, type Address } from 'viem';
import * as A from '@/contracts/artifacts';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { explorerAddress } from '@/config/networks';
import { mintTestToken, readPool, stake, type PoolDetail } from '@/lib/vault';
import { reward } from '@/lib/pool';
import { errorText, publicClient } from '@/lib/tx';
import { countdown, fmt, fmtDate, months, short } from '@/lib/format';
import { TokenIcon } from '@/components/TokenIcon';
import { CapacityRing } from '@/components/CapacityRing';
import { useChainNow } from '@/hooks/useChainNow';

export default function PoolPage() {
  return (
    <Suspense fallback={null}>
      <Pool />
    </Suspense>
  );
}

function Pool() {
  const v = useSearchParams().get('v') ?? '';
  const vault = isAddress(v) ? (v as Address) : undefined;
  const { net } = useNetwork();
  const { address, isConnected } = useAccount();
  const [pool, setPool] = useState<PoolDetail>();
  const [loadError, setLoadError] = useState<string>();
  const [sleeveId, setSleeveId] = useState(0);
  const [tierId, setTierId] = useState(0);
  const [lockId, setLockId] = useState(0);
  const [amountText, setAmountText] = useState('');
  const [fixedIndex, setFixedIndex] = useState(0);
  const [balance, setBalance] = useState<bigint>();
  const [quote, setQuote] = useState<bigint>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const now = useChainNow(net);

  const load = useCallback(() => {
    if (!vault) return;
    readPool(net, vault).then(setPool, (e) => setLoadError(errorText(e)));
  }, [net, vault]);
  useEffect(load, [load]);

  const sleeve = pool?.sleeves[sleeveId];
  const tier = sleeve?.tiers[tierId];
  const fixed = tier?.kind === 1;
  const effLock = fixed ? tier!.lockOptionId : lockId;

  const amount = useMemo(() => {
    if (!sleeve || !tier) return 0n;
    if (fixed) return tier.amounts[fixedIndex] ?? 0n;
    try {
      return parseUnits(amountText.replace(/,/g, '') || '0', sleeve.asset.decimals);
    } catch {
      return 0n;
    }
  }, [sleeve, tier, fixed, fixedIndex, amountText]);

  const refreshBalance = useCallback(() => {
    if (!sleeve || !address) return;
    publicClient(net.l1)
      .readContract({ address: sleeve.asset.token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
      .then(setBalance, () => setBalance(undefined));
  }, [net, sleeve, address]);
  useEffect(refreshBalance, [refreshBalance]);

  // Exact on-chain quote, so the number shown is the number reserved.
  useEffect(() => {
    setQuote(undefined);
    if (!pool || !sleeve || !tier || (!fixed && amount === 0n)) return;
    publicClient(net.l1)
      .readContract({
        address: pool.vault,
        abi: A.PoolVault.abi,
        functionName: 'quote',
        args: [BigInt(sleeveId), BigInt(tierId), fixed ? BigInt(fixedIndex) : amount, BigInt(effLock)],
      })
      .then(setQuote, () => setQuote(undefined));
  }, [net, pool, sleeve, tier, fixed, fixedIndex, amount, sleeveId, tierId, effLock]);

  if (!vault) return <p className="card text-sm text-slate-400">Missing pool address. Open a pool from the Pools page.</p>;
  if (loadError) return <p className="card text-sm text-red-400">{loadError}</p>;
  if (!pool || !sleeve || !tier) return <p className="text-sm text-slate-500">Loading pool…</p>;

  const lock = pool.locks[effLock];
  const open = BigInt(now) >= pool.depositStart && BigInt(now) < pool.depositEnd;
  const capLeft = sleeve.cap - sleeve.totalStaked;
  const issues: string[] = [];
  if (BigInt(now) < pool.depositStart) issues.push(`Deposits open in ${countdown(pool.depositStart, now)}`);
  if (BigInt(now) >= pool.depositEnd) issues.push('Deposits are closed');
  if (pool.paused.deposits || pool.paused.all) issues.push('Deposits are paused');
  if (!sleeve.healthy) issues.push(`New ${sleeve.asset.symbol} stakes are halted: Morpheus settings changed (exits are not affected)`);
  if (!fixed && amount > 0n && amount < tier.minPerWallet) issues.push(`Minimum stake is ${fmt(tier.minPerWallet, sleeve.asset.decimals)} ${sleeve.asset.symbol}`);
  if (amount > capLeft) issues.push(`Only ${fmt(capLeft, sleeve.asset.decimals)} ${sleeve.asset.symbol} left in the cap`);
  if (balance !== undefined && amount > balance) issues.push(`Your ${sleeve.asset.symbol} balance is too low`);
  if (quote !== undefined && quote > pool.available) issues.push('The pool does not have enough reward budget left for this stake');
  const canStake = isConnected && open && issues.length === 0 && amount > 0n && !busy;

  const doStake = async () => {
    if (!address) return;
    setBusy('stake');
    setError(undefined);
    setDone(undefined);
    try {
      const { hash } = await stake(net, address, pool.vault, sleeve, tierId, fixed ? BigInt(fixedIndex) : amount, amount, effLock);
      setDone(hash);
      setAmountText('');
      load();
      refreshBalance();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const faucet = async () => {
    if (!address) return;
    setBusy('mint');
    setError(undefined);
    try {
      await mintTestToken(net, address, sleeve.asset, '100');
      refreshBalance();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const mults = pool.locks.map((l) => l.multBps);
  const YEAR = 365n * 86400n;
  const statusPill =
    BigInt(now) < pool.depositStart
      ? { label: `Opens in ${countdown(pool.depositStart, now)}`, tone: 'bg-sky-500/10 text-sky-300' }
      : open
        ? { label: 'Open', tone: 'bg-mor/10 text-mor' }
        : { label: 'Closed', tone: 'bg-white/5 text-slate-400' };
  const capRatio = sleeve.cap === 0n ? 0 : Number((sleeve.totalStaked * 1_000_000n) / sleeve.cap) / 1_000_000;
  const multX = ((fixed ? tier.multBps[fixedIndex] : lock.multBps) / 10000).toFixed(2);

  return (
    <div className="space-y-6">
      <Link href="/pools/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Pools
      </Link>

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <TokenIcon symbol={pool.reward.symbol} reward size={52} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-white">{pool.reward.symbol} pool</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPill.tone}`}>{statusPill.label}</span>
              {!pool.featured && <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">not featured</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <a className="hover:text-slate-300" href={explorerAddress(net.l1, pool.vault)} target="_blank" rel="noreferrer">
                Pool {short(pool.vault)} ↗
              </a>
              <a className="hover:text-slate-300" href={explorerAddress(net.l1, pool.reward.token)} target="_blank" rel="noreferrer">
                Reward token {short(pool.reward.token)} ↗
              </a>
              <span>Partner {short(pool.partner)}</span>
            </div>
          </div>
        </div>
      </div>

      {!pool.featured && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          Not featured, not reviewed by Morpheus DAT. Check the Partner and reward token before staking.
        </p>
      )}

      {/* stat bar */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-line bg-ink-line md:grid-cols-4">
        <Stat label="Reward capacity left" value={`${fmt(pool.available, pool.reward.decimals, 0)} ${pool.reward.symbol}`} />
        <Stat label="Lock options" value={`${months(pool.locks.reduce((a, b) => (b.duration < a.duration ? b : a)).duration).replace(' months', '')} – ${months(pool.locks.reduce((a, b) => (b.duration > a.duration ? b : a)).duration)}`} />
        <Stat label="Multiplier" value={`${(Math.min(...mults) / 10000).toFixed(2)}x – ${(Math.max(...mults) / 10000).toFixed(2)}x`} />
        <Stat label="Deposits close" value={new Date(Number(pool.depositEnd) * 1000).toLocaleDateString()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          {/* per-asset overview */}
          {pool.sleeves.map((s) => {
            const ratio = s.cap === 0n ? 0 : Number((s.totalStaked * 1_000_000n) / s.cap) / 1_000_000;
            return (
              <section key={s.id} className="rounded-2xl border border-ink-line bg-ink-soft p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <TokenIcon symbol={s.asset.symbol} size={36} />
                    <div>
                      <div className="font-medium text-white">Stake {s.asset.symbol}</div>
                      <div className="text-xs text-slate-500">
                        {s.healthy ? 'Morpheus Capital pool active' : 'New stakes halted: Morpheus settings changed'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white">
                    <CapacityRing ratio={ratio} size={22} />
                    <div className="text-right">
                      <div>{ratio > 0 && ratio < 0.001 ? '<0.1' : (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%</div>
                      <div className="text-[11px] text-slate-500">
                        {fmt(s.totalStaked, s.asset.decimals)} / {fmt(s.cap, s.asset.decimals)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="pb-2 text-left font-normal">Lock</th>
                        <th className="pb-2 text-right font-normal">Multiplier</th>
                        <th className="pb-2 text-right font-normal">
                          Per year · per {fmt(s.unit, s.asset.decimals)} {s.asset.symbol}
                        </th>
                        <th className="pb-2 text-right font-normal">Over the lock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-line text-slate-200">
                      {pool.locks.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2.5">{months(l.duration)}</td>
                          <td className="py-2.5 text-right text-slate-400">{(l.multBps / 10000).toFixed(2)}x</td>
                          <td className="py-2.5 text-right">
                            {fmt(reward(s.unit, s.ratePerUnit, s.unit, l.multBps, YEAR), pool.reward.decimals)} {pool.reward.symbol}
                          </td>
                          <td className="py-2.5 text-right font-medium text-white">
                            {fmt(reward(s.unit, s.ratePerUnit, s.unit, l.multBps, l.duration), pool.reward.decimals)} {pool.reward.symbol}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          <section className="rounded-2xl border border-ink-line bg-ink-soft p-5">
            <h2 className="mb-4 font-medium text-white">How it works</h2>
            <ol className="space-y-4 text-sm">
              {[
                ['Stake', 'Your reward is fixed and reserved in full the moment you stake. It accrues every second; claim it any time.'],
                ['Locked', 'Your staked tokens go to Morpheus Capital, where their yield earns MOR for the Partner. 30 days before unlock they are moved back into this pool.'],
                ['Unstake', 'At unlock, withdraw the full amount you staked plus any reward not yet claimed.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mor/10 text-xs font-semibold text-mor">{i + 1}</span>
                  <div>
                    <div className="font-medium text-white">{t}</div>
                    <div className="text-slate-400">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-slate-500">
              Deposits {fmtDate(pool.depositStart)} → {fmtDate(pool.depositEnd)}
            </p>
          </section>
        </div>

        {/* stake panel */}
        <aside className="order-first h-fit space-y-4 rounded-2xl border border-ink-line bg-ink-soft p-5 lg:order-none lg:sticky lg:top-6">
          <h2 className="text-lg font-semibold text-white">Stake</h2>

          {pool.sleeves.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {pool.sleeves.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSleeveId(s.id);
                    setTierId(0);
                    setAmountText('');
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    sleeveId === s.id ? 'border-mor bg-mor/10 text-white' : 'border-ink-line text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <TokenIcon symbol={s.asset.symbol} size={22} />
                  {s.asset.symbol}
                </button>
              ))}
            </div>
          )}

          {sleeve.tiers.length > 1 && (
            <Segmented
              options={sleeve.tiers.map((t, i) => [i, t.kind === 1 ? 'Fixed amount' : 'Any amount'])}
              value={tierId}
              onChange={setTierId}
            />
          )}

          {/* amount */}
          <div className="rounded-xl border border-ink-line bg-ink p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>Amount</span>
              {balance !== undefined && (
                <span>
                  Balance {fmt(balance, sleeve.asset.decimals)}
                  {!fixed && (
                    <button
                      className="ml-2 rounded bg-white/5 px-1.5 py-0.5 font-medium text-slate-300 hover:text-mor"
                      onClick={() => setAmountText(fmt(balance, sleeve.asset.decimals, 18).replace(/,/g, ''))}
                    >
                      MAX
                    </button>
                  )}
                </span>
              )}
            </div>
            {fixed ? (
              <div className="flex flex-wrap gap-2">
                {tier.amounts.map((a, i) => (
                  <button key={i} className={fixedIndex === i ? 'btn-primary' : 'btn-ghost'} onClick={() => setFixedIndex(i)}>
                    {fmt(a, sleeve.asset.decimals)} {sleeve.asset.symbol}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  className="min-w-0 flex-1 bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-slate-600"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                />
                <span className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3 text-sm text-white">
                  <TokenIcon symbol={sleeve.asset.symbol} size={22} />
                  {sleeve.asset.symbol}
                </span>
              </div>
            )}
          </div>

          {/* lock */}
          <div>
            <div className="mb-2 text-xs text-slate-500">Lock</div>
            {fixed ? (
              <p className="text-sm text-slate-300">{months(lock.duration)} (fixed for this tier)</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {pool.locks.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLockId(l.id)}
                    className={`rounded-xl border px-2 py-2 text-center ${
                      lockId === l.id ? 'border-mor bg-mor/10' : 'border-ink-line hover:border-slate-500'
                    }`}
                  >
                    <div className="text-sm font-medium text-white">{months(l.duration).replace(' months', 'm')}</div>
                    <div className="text-[11px] text-slate-400">{(l.multBps / 10000).toFixed(2)}x</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* overview */}
          <div className="space-y-2 rounded-xl border border-ink-line p-4 text-sm">
            <div className="text-xs text-slate-500">Transaction overview</div>
            <Row k="You receive">
              <span className="flex items-center gap-1.5 font-semibold text-white">
                <TokenIcon symbol={pool.reward.symbol} reward size={16} />
                {quote !== undefined ? `${fmt(quote, pool.reward.decimals)} ${pool.reward.symbol}` : '—'}
              </span>
            </Row>
            <Row k="≈ Per day">
              {quote !== undefined && quote > 0n ? `${fmt((quote * 86400n) / lock.duration, pool.reward.decimals)} ${pool.reward.symbol}` : '—'}
            </Row>
            <Row k="Multiplier">{multX}x</Row>
            <Row k="Unlock">{fmtDate(BigInt(now) + lock.duration)}</Row>
            <Row k="Stake back at unlock">
              {amount > 0n ? fmt(amount, sleeve.asset.decimals) : '—'} {sleeve.asset.symbol}
            </Row>
            <Row k="Capacity filled">
              <span className="flex items-center gap-1.5">
                <CapacityRing ratio={capRatio} size={14} />
                {capRatio > 0 && capRatio < 0.001 ? '<0.1' : (capRatio * 100).toFixed(capRatio < 0.1 ? 1 : 0)}%
              </span>
            </Row>
          </div>

          {issues.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-300">
              {issues.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          )}
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
          {done && (
            <p className="text-xs text-mor">
              Staked.{' '}
              <Link className="underline" href="/dashboard/">
                See your positions
              </Link>
            </p>
          )}

          {isConnected ? (
            <button
              className="flex w-full items-center justify-center gap-2 rounded-full bg-mor py-3.5 text-sm font-semibold text-ink transition hover:bg-mor/90 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
              disabled={!canStake}
              onClick={doStake}
            >
              {busy === 'stake' ? 'Confirm in your wallet…' : amount > 0n ? `Approve and stake ${fmt(amount, sleeve.asset.decimals)} ${sleeve.asset.symbol}` : 'Enter an amount'}
            </button>
          ) : (
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          )}
          {net.name === 'local' && isConnected && (
            <Link className="block text-center text-xs text-slate-400 hover:text-mor" href="/sandbox/">
              Sandbox: get {sleeve.asset.symbol} and skip time
            </Link>
          )}
          {net.name === 'testnet' && isConnected && sleeve.asset.faucet && (
            <button className="w-full text-xs text-slate-400 hover:text-mor disabled:opacity-40" disabled={!!busy} onClick={faucet}>
              {busy === 'mint' ? 'Minting…' : `Testnet: get 100 ${sleeve.asset.symbol}${sleeve.asset.faucet === 'open' ? '' : ' (Aave faucet)'}`}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-soft px-5 py-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="text-right text-slate-200">{children}</span>
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: [number, string][]; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-ink p-1">
      {options.map(([k, label]) => (
        <button
          key={k}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm ${value === k ? 'bg-ink-soft text-white' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
