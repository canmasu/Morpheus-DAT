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
import { countdown, fmt, fmtDate, months } from '@/lib/format';
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

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {!pool.featured && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            Not featured, not reviewed by Morpheus DAT. Check the Partner and reward token before staking.
          </p>
        )}
        <div>
          <Link href="/pools/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Pools
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-white">Earn {pool.reward.symbol}</h1>
          <p className="mono mt-1 text-slate-500">
            pool{' '}
            <a className="hover:underline" href={explorerAddress(net.l1, pool.vault)} target="_blank" rel="noreferrer">
              {pool.vault}
            </a>{' '}
            · reward token{' '}
            <a className="hover:underline" href={explorerAddress(net.l1, pool.reward.token)} target="_blank" rel="noreferrer">
              {pool.reward.token}
            </a>
          </p>
        </div>

        <section className="card space-y-3">
          <h2 className="font-medium text-white">Rewards over the lock</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-left font-normal">Lock</th>
                {pool.sleeves.map((s) => (
                  <th key={s.id} className="py-1 text-right font-normal">
                    per {fmt(s.unit, s.asset.decimals)} {s.asset.symbol}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line text-slate-300">
              {pool.locks.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5">
                    {months(l.duration)} · {(l.multBps / 10000).toFixed(2)}x
                  </td>
                  {pool.sleeves.map((s) => (
                    <td key={s.id} className="py-1.5 text-right">
                      {fmt(reward(s.unit, s.ratePerUnit, s.unit, l.multBps, l.duration), pool.reward.decimals)} {pool.reward.symbol}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card space-y-2 text-sm text-slate-400">
          <h2 className="font-medium text-white">How it works</h2>
          <p>Your reward is fixed and reserved when you stake. It accrues every second and you can claim it any time.</p>
          <p>
            Your staked tokens go to Morpheus Capital, where their yield earns MOR for the Partner. 30 days before your unlock they are
            moved back into the pool, so at unlock you withdraw the full amount you staked.
          </p>
          <p>
            Deposits: {fmtDate(pool.depositStart)} → {fmtDate(pool.depositEnd)}. Reward capacity left:{' '}
            {fmt(pool.available, pool.reward.decimals)} {pool.reward.symbol}.
          </p>
        </section>
      </div>

      <aside className="card h-fit space-y-4">
        <h2 className="font-medium text-white">Stake</h2>
        {pool.sleeves.length > 1 && (
          <Segmented
            options={pool.sleeves.map((s) => [s.id, s.asset.symbol])}
            value={sleeveId}
            onChange={(id) => {
              setSleeveId(id);
              setTierId(0);
              setAmountText('');
            }}
          />
        )}
        {sleeve.tiers.length > 1 && (
          <Segmented
            options={sleeve.tiers.map((t, i) => [i, t.kind === 1 ? 'Fixed amount' : 'Any amount'])}
            value={tierId}
            onChange={setTierId}
          />
        )}

        {fixed ? (
          <div>
            <label className="label">Amount</label>
            <div className="flex flex-wrap gap-2">
              {tier.amounts.map((a, i) => (
                <button key={i} className={fixedIndex === i ? 'btn-primary' : 'btn-ghost'} onClick={() => setFixedIndex(i)}>
                  {fmt(a, sleeve.asset.decimals)} {sleeve.asset.symbol}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between">
              <label className="label">Amount ({sleeve.asset.symbol})</label>
              {balance !== undefined && (
                <button className="text-xs text-slate-400 hover:text-mor" onClick={() => setAmountText(fmt(balance, sleeve.asset.decimals, 18).replace(/,/g, ''))}>
                  balance {fmt(balance, sleeve.asset.decimals)}
                </button>
              )}
            </div>
            <input className="input" inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </div>
        )}

        <div>
          <label className="label">Lock</label>
          {fixed ? (
            <p className="text-sm text-slate-300">{months(lock.duration)} (fixed for this tier)</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {pool.locks.map((l) => (
                <button key={l.id} className={lockId === l.id ? 'btn-primary' : 'btn-ghost'} onClick={() => setLockId(l.id)}>
                  {months(l.duration).replace(' months', 'm')} · {(l.multBps / 10000).toFixed(2)}x
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-ink p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">You receive</span>
            <span className="text-white">{quote !== undefined ? `${fmt(quote, pool.reward.decimals)} ${pool.reward.symbol}` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Unlock</span>
            <span className="text-slate-300">{fmtDate(BigInt(now) + lock.duration)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Stake back at unlock</span>
            <span className="text-slate-300">
              {amount > 0n ? fmt(amount, sleeve.asset.decimals) : '—'} {sleeve.asset.symbol}
            </span>
          </div>
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
          <button className="btn-primary w-full" disabled={!canStake} onClick={doStake}>
            {busy === 'stake' ? 'Confirm in your wallet…' : 'Approve and stake'}
          </button>
        ) : (
          <ConnectButton />
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
  );
}

function Segmented({ options, value, onChange }: { options: [number, string][]; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-ink p-1">
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
