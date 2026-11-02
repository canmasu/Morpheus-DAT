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
import { mintTestToken, readPool, refAmount, stake, type PoolDetail } from '@/lib/vault';
import { baseMultBps, fmtMult, reward } from '@/lib/pool';
import { errorText, publicClient } from '@/lib/tx';
import { countdown, fmt, fmtCompact, fmtDate, months, short } from '@/lib/format';
import { ShareButton } from '@/components/ShareButton';
import { AddToWallet } from '@/components/AddToWallet';
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
  // The tier follows the amount (Alpha brackets below Omega's range) unless the pool uses one-click fixed amounts.
  const autoTier = !!sleeve && sleeve.tiers.every((t) => t.kind !== 1);
  const typed = useMemo(() => {
    if (!sleeve) return 0n;
    try {
      return parseUnits(amountText.replace(/,/g, '') || '0', sleeve.asset.decimals);
    } catch {
      return 0n;
    }
  }, [sleeve, amountText]);
  const activeTierId = autoTier && sleeve ? pickTier(sleeve.tiers, typed) : tierId;
  const tier = sleeve?.tiers[activeTierId];
  const fixed = tier?.kind === 1;
  const bracket = tier?.kind === 2;
  const effLock = fixed || bracket ? tier!.lockOptionId : lockId;
  const amount = useMemo(() => (fixed && tier ? (tier.amounts[fixedIndex] ?? 0n) : typed), [fixed, tier, fixedIndex, typed]);

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
        args: [BigInt(sleeveId), BigInt(activeTierId), fixed ? BigInt(fixedIndex) : amount, BigInt(effLock)],
      })
      .then(setQuote, () => setQuote(undefined));
  }, [net, pool, sleeve, tier, fixed, fixedIndex, amount, sleeveId, activeTierId, effLock]);

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
  if (!fixed && amount > 0n && !tierFits(tier, amount)) {
    const lo = sleeve.tiers.reduce((m, t) => (tierMin(t) < m ? tierMin(t) : m), tierMin(sleeve.tiers[0]));
    issues.push(
      amount < lo
        ? `Minimum stake is ${fmt(lo, sleeve.asset.decimals)} ${sleeve.asset.symbol}`
        : `${fmt(amount, sleeve.asset.decimals)} ${sleeve.asset.symbol} is above the maximum for this pool`,
    );
  }
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
      const { hash } = await stake(net, address, pool.vault, sleeve, activeTierId, fixed ? BigInt(fixedIndex) : amount, amount, effLock);
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
  const base = baseMultBps(pool.locks, pool.sleeves.flatMap((x) => x.tiers));
  const allMults = [...mults, ...pool.sleeves.flatMap((x) => x.tiers.filter((t) => t.kind !== 0).flatMap((t) => [...t.multBps]))];
  const curMult = fixed ? tier.multBps[fixedIndex] : bracket ? bracketMult(tier, amount) : lock.multBps;
  const multX = fmtMult(curMult, base);
  const hasAlpha = sleeve.tiers.some((t) => t.kind === 2);
  const tierName = (t: (typeof sleeve.tiers)[number]) => (t.kind === 2 ? 'Alpha' : t.kind === 0 && hasAlpha ? 'Omega' : '');

  // Share text: the smallest stake this asset allows, on its lock, with the exact reward.
  const shortestLock = pool.locks.reduce((a, b) => (b.duration < a.duration ? b : a));
  const examples = sleeve.tiers.flatMap((t) =>
    t.kind === 1
      ? t.amounts.map((a, i) => ({ amount: a, mult: t.multBps[i], lock: pool.locks[t.lockOptionId] }))
      : t.kind === 2
        ? [{ amount: t.amounts[0], mult: t.multBps[0], lock: pool.locks[t.lockOptionId] }]
          : [{ amount: t.minPerWallet > 0n ? t.minPerWallet : 10n ** BigInt(sleeve.asset.decimals), mult: shortestLock.multBps, lock: shortestLock }],
  );
  const ex = examples.reduce((a, b) => (b.amount < a.amount ? b : a));
  const exReward = reward(ex.amount, sleeve.ratePerUnit, sleeve.unit, ex.mult, ex.lock.duration);
  const shareText =
    `Stake ${fmt(ex.amount, sleeve.asset.decimals)} ${sleeve.asset.symbol} for ${months(ex.lock.duration)} in the ${pool.reward.symbol} pool on Morpheus DAT: ` +
    `get your ${fmt(ex.amount, sleeve.asset.decimals)} ${sleeve.asset.symbol} back at unlock + ${fmt(exReward, pool.reward.decimals)} ${pool.reward.symbol}.`;
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/pool/?v=${pool.vault}` : '';
  const tierLabel = (t: (typeof sleeve.tiers)[number]) =>
    t.kind === 1
      ? `Fixed: ${t.amounts.map((a) => fmtCompact(a, sleeve.asset.decimals)).join(' / ')}`
      : `${tierName(t) ? `${tierName(t)} · ` : ''}${fmtCompact(tierMin(t), sleeve.asset.decimals)} – ${t.maxPerWallet > 0n ? fmtCompact(t.maxPerWallet, sleeve.asset.decimals) : 'any'} ${sleeve.asset.symbol}`;

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
              <AddToWallet chain={net.l1} token={pool.reward.token} symbol={pool.reward.symbol} decimals={pool.reward.decimals} />
            </div>
          </div>
        </div>
        <ShareButton text={shareText} url={shareUrl} />
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
        <Stat label="Multiplier" value={`${fmtMult(Math.min(...allMults), base)} – ${fmtMult(Math.max(...allMults), base)}`} />
        <Stat label="Deposits close" value={new Date(Number(pool.depositEnd) * 1000).toLocaleDateString()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          {/* overview of the asset selected in the Stake panel */}
          {pool.sleeves.filter((s) => s.id === sleeveId).map((s) => {
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
                  {s.tiers.some((t) => t.kind === 2) &&
                    s.tiers
                      .filter((t) => t.kind === 0)
                      .map((t, ti) => (
                        <div key={ti} className="mb-2 text-xs font-medium text-slate-300">
                          Omega · {fmt(t.minPerWallet, s.asset.decimals)} – {t.maxPerWallet > 0n ? fmt(t.maxPerWallet, s.asset.decimals) : 'any'}{' '}
                          {s.asset.symbol} · choose a lock
                        </div>
                      ))}
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="pb-2 text-left font-normal">Lock</th>
                        <th className="pb-2 text-right font-normal">Multiplier</th>
                        <th className="pb-2 text-right font-normal">
                          Per year · per {fmt(refAmount(s), s.asset.decimals)} {s.asset.symbol}
                        </th>
                        <th className="pb-2 text-right font-normal">Over the lock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-line text-slate-200">
                      {pool.locks.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2.5">{months(l.duration)}</td>
                          <td className="py-2.5 text-right text-slate-400">{fmtMult(l.multBps, base)}</td>
                          <td className="py-2.5 text-right">
                            {fmt(reward(refAmount(s), s.ratePerUnit, s.unit, l.multBps, YEAR), pool.reward.decimals)} {pool.reward.symbol}
                          </td>
                          <td className="py-2.5 text-right font-medium text-white">
                            {fmt(reward(refAmount(s), s.ratePerUnit, s.unit, l.multBps, l.duration), pool.reward.decimals)} {pool.reward.symbol}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.tiers
                  .filter((t) => t.kind === 2)
                  .map((t, ti) => (
                    <div key={ti} className="mt-6 overflow-x-auto">
                      <div className="mb-2 text-xs font-medium text-slate-300">
                        Alpha · {fmt(t.amounts[0], s.asset.decimals)} – {t.maxPerWallet > 0n ? fmt(t.maxPerWallet, s.asset.decimals) : 'any'}{' '}
                        {s.asset.symbol} · {months(pool.locks[t.lockOptionId].duration)}
                      </div>
                      <table className="w-full text-sm">
                        <thead className="text-xs text-slate-500">
                          <tr>
                            <th className="pb-2 text-left font-normal">Stake from</th>
                            <th className="pb-2 text-right font-normal">Multiplier</th>
                            <th className="pb-2 text-right font-normal">Per year at that amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-line text-slate-200">
                          {t.amounts.map((a, i) => (
                            <tr key={i}>
                              <td className="py-2.5">
                                {fmt(a, s.asset.decimals)} {s.asset.symbol}
                              </td>
                              <td className="py-2.5 text-right text-slate-400">{fmtMult(t.multBps[i], base)}</td>
                              <td className="py-2.5 text-right font-medium text-white">
                                {fmt(reward(a, s.ratePerUnit, s.unit, t.multBps[i], YEAR), pool.reward.decimals)} {pool.reward.symbol}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
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

          {!autoTier && sleeve.tiers.length > 1 && (
            <Segmented
              options={sleeve.tiers.map((t, i) => [i, tierLabel(t)])}
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

          {autoTier && sleeve.tiers.length > 1 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {sleeve.tiers.map((t, i) => (
                <span
                  key={i}
                  className={`rounded-full px-2.5 py-1 ${
                    i === activeTierId && amount > 0n && tierFits(t, amount) ? 'bg-mor/15 text-mor' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {tierLabel(t)}
                </span>
              ))}
            </div>
          )}

          {/* lock */}
          <div>
            <div className="mb-2 text-xs text-slate-500">Lock</div>
            {fixed || bracket ? (
              <p className="text-sm text-slate-300">
                {months(lock.duration)} (fixed for the {tierName(tier) || 'selected'} tier)
              </p>
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
                    <div className="text-[11px] text-slate-400">{fmtMult(l.multBps, base)}</div>
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
            <Row k="Multiplier">{multX}</Row>
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

type TierView = PoolDetail['sleeves'][number]['tiers'][number];

/** Smallest single stake a tier accepts. */
const tierMin = (t: TierView) => (t.kind === 2 ? t.amounts[0] : t.kind === 1 ? t.amounts.reduce((a, b) => (b < a ? b : a)) : t.minPerWallet);

/** Whether a single stake of `amount` falls in the tier (wallet totals are checked by the contract). */
const tierFits = (t: TierView, amount: bigint) =>
  t.kind === 1 ? t.amounts.includes(amount) : amount >= tierMin(t) && (t.maxPerWallet === 0n || amount <= t.maxPerWallet);

/** The tier a typed amount belongs to; below every tier → the smallest, above every tier → the largest. */
function pickTier(tiers: TierView[], amount: bigint): number {
  const hit = tiers.findIndex((t) => tierFits(t, amount));
  if (hit >= 0) return hit;
  let best = 0;
  tiers.forEach((t, i) => {
    if (amount < tierMin(tiers[best]) ? tierMin(t) < tierMin(tiers[best]) : tierMin(t) > tierMin(tiers[best])) best = i;
  });
  return best;
}

/** Multiplier of the highest Alpha bracket the amount reaches. */
function bracketMult(t: TierView, amount: bigint) {
  let i = 0;
  t.amounts.forEach((a, j) => {
    if (a <= amount) i = j;
  });
  return t.multBps[i];
}
