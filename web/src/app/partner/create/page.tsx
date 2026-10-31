'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, isAddress, type Address } from 'viem';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { explorerAddress } from '@/config/networks';
import { buildConfig, defaultForm, monthsToSeconds, reward, type PoolForm, type SleeveForm } from '@/lib/pool';
import { approveIfNeeded, contractsFor, createPool, createTestToken, deploySplitter, tokenInfo } from '@/lib/partner';
import { errorText } from '@/lib/tx';
import { load, save } from '@/lib/storage';
import { useChainNow } from '@/hooks/useChainNow';

type Token = Awaited<ReturnType<typeof tokenInfo>>;
type Phase = 'form' | 'approve' | 'create' | 'splitter' | 'done';
const PHASES: [Phase, string][] = [
  ['approve', 'Approve the reward budget'],
  ['create', 'Create the pool on Ethereum'],
  ['splitter', 'Deploy the MOR splitter on Arbitrum'],
];

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function CreatePoolPage() {
  const { address, isConnected } = useAccount();
  const { net } = useNetwork();
  const { factory, splitterDeployer } = contractsFor(net);
  const draftKey = `dat-pool-draft-${net.name}`;
  const chainNow = useChainNow(net);
  const chainNowMs = chainNow * 1000;
  const chainAhead = chainNow - Math.floor(Date.now() / 1000) > 60;

  const [form, setForm] = useState<PoolForm>(() => defaultForm(net));
  const [token, setToken] = useState<Token>();
  const [tokenTick, setTokenTick] = useState(0);
  const [phase, setPhase] = useState<Phase>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ vault: Address; morReceiver: Address }>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const draft = load<PoolForm>(draftKey);
    const base = defaultForm(net, chainNowMs);
    // Dates always start fresh; everything else comes from the saved draft.
    setForm(draft ? { ...base, ...draft, start: base.start, end: base.end } : base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, net, chainAhead]);

  const update = (f: PoolForm) => {
    setForm(f);
    save(draftKey, f);
  };
  const setSleeve = (sym: string, patch: Partial<SleeveForm>) =>
    update({ ...form, sleeves: { ...form.sleeves, [sym]: { ...form.sleeves[sym], ...patch } } });

  useEffect(() => {
    setToken(undefined);
    if (!isAddress(form.rewardToken)) return;
    tokenInfo(net, form.rewardToken, address, factory).then(setToken, () => setToken(undefined));
  }, [net, form.rewardToken, address, factory, tokenTick]);

  const built = useMemo(() => buildConfig(form, net, token?.decimals, chainNowMs), [form, net, token?.decimals, chainNowMs]);
  const balanceShort = token && built.budget > token.balance;
  const canSubmit = isConnected && factory && splitterDeployer && built.errors.length === 0 && !balanceShort && !busy;

  const run = async () => {
    if (!address || !factory || !splitterDeployer) return;
    setBusy(true);
    setError(undefined);
    try {
      let pool = created;
      if (!pool) {
        setPhase('approve');
        await approveIfNeeded(net, address, built.cfg.rewardToken, factory, built.budget);
        setPhase('create');
        pool = await createPool(net, address, factory, built.cfg, built.budget);
        setCreated(pool);
      }
      setPhase('splitter');
      await deploySplitter(net, address, factory, splitterDeployer, pool.vault);
      setPhase('done');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const makeTestToken = async () => {
    if (!address) return;
    setBusy(true);
    setError(undefined);
    try {
      const t = await createTestToken(net, address);
      update({ ...form, rewardToken: t });
      setTokenTick((x) => x + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  if (!factory) return <p className="card text-sm text-amber-300">Morpheus DAT is not deployed on {net.label} yet.</p>;

  if (phase === 'done' && created) {
    return (
      <div className="card mx-auto max-w-xl space-y-4">
        <h1 className="text-xl font-semibold text-white">Pool created</h1>
        <p className="text-sm text-slate-400">
          Your pool is live on {net.l1.name} and its MOR splitter is live on {net.l2.name}. It is reachable by direct link and will be
          listed once DAT features it.
        </p>
        <dl className="space-y-2 text-sm">
          <Row k="Pool vault" v={created.vault} href={explorerAddress(net.l1, created.vault)} />
          <Row k={`MOR splitter (${net.l2.name})`} v={created.morReceiver} href={explorerAddress(net.l2, created.morReceiver)} />
        </dl>
        <Link className="btn-primary" href="/partner/">
          Go to your pools
        </Link>
      </div>
    );
  }

  const enabledAssets = net.stakeAssets.filter((a) => form.sleeves[a.symbol]?.enabled);
  const rSym = token?.symbol ?? 'tokens';

  return (
    <div className="space-y-8">
      <div>
        <Link href="/partner/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Partners
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Create a pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Set the reward rates, locks, caps and dates, then fund the budget. Each reward is reserved in full when a contributor stakes,
          so the pool can never promise more than it holds.
        </p>
      </div>

      {!isConnected && (
        <div className="card flex items-center justify-between">
          <span className="text-sm text-slate-400">Connect the wallet that will own the pool and receive MOR.</span>
          <ConnectButton />
        </div>
      )}

      <Section n={1} title="Reward token">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Partner Token address on {net.l1.name}</label>
            <input
              className="input"
              placeholder="0x…"
              value={form.rewardToken}
              disabled={!!created}
              onChange={(e) => update({ ...form, rewardToken: e.target.value.trim() })}
            />
          </div>
          <div className="text-sm">
            {token ? (
              <p className="pt-6 text-slate-300">
                {token.symbol} · {token.decimals} decimals · your balance{' '}
                <span className="text-white">{fmt(token.balance, token.decimals)}</span>
              </p>
            ) : isAddress(form.rewardToken) ? (
              <p className="pt-6 text-red-400">Not an ERC-20 token on {net.l1.name}.</p>
            ) : null}
          </div>
        </div>
        {net.name !== 'mainnet' && isConnected && !created && (
          <p className="text-sm text-slate-400">
            No token yet?{' '}
            <button className="text-mor hover:underline disabled:opacity-40" disabled={busy} onClick={makeTestToken}>
              Create a test reward token (tEXM, 42,000,000 to you)
            </button>
          </p>
        )}
      </Section>

      <Section n={2} title="Lock options">
        <p className="text-xs text-slate-500">
          12 months = 365 days. Each lock must be at least the epoch length + 30 days, because Capital Accounts leave Morpheus 30 days
          before unlock.
        </p>
        <div className="space-y-2">
          {form.locks.map((l, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-6 text-xs text-slate-500">#{i}</span>
              <input
                className="input w-28"
                value={l.months}
                onChange={(e) => update({ ...form, locks: form.locks.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)) })}
              />
              <span className="text-xs text-slate-500">months ×</span>
              <input
                className="input w-24"
                value={l.mult}
                onChange={(e) => update({ ...form, locks: form.locks.map((x, j) => (j === i ? { ...x, mult: e.target.value } : x)) })}
              />
              <span className="text-xs text-slate-500">multiplier</span>
              <button
                className="text-xs text-slate-500 hover:text-red-300"
                onClick={() => update({ ...form, locks: form.locks.filter((_, j) => j !== i) })}
              >
                remove
              </button>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={() => update({ ...form, locks: [...form.locks, { months: '12', mult: '1.00' }] })}>
          Add lock
        </button>
      </Section>

      <Section n={3} title="Stake assets and rates">
        {net.stakeAssets.map((a) => {
          const f = form.sleeves[a.symbol];
          if (!f) return null;
          return (
            <div key={a.symbol} className="rounded-lg border border-ink-line p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-white">
                <input type="checkbox" checked={f.enabled} onChange={(e) => setSleeve(a.symbol, { enabled: e.target.checked })} />
                Accept {a.symbol}
              </label>
              {f.enabled && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Input label={`Reward per year (${rSym})`} value={f.rate} onChange={(v) => setSleeve(a.symbol, { rate: v })} />
                    <Input label={`… for every (${a.symbol})`} value={f.unitAmount} onChange={(v) => setSleeve(a.symbol, { unitAmount: v })} />
                    <Input label={`Pool cap (${a.symbol})`} value={f.cap} onChange={(v) => setSleeve(a.symbol, { cap: v })} />
                    <Input label={`Min per stake (${a.symbol})`} value={f.minPerWallet} onChange={(v) => setSleeve(a.symbol, { minPerWallet: v })} />
                    <Input
                      label={`Max per wallet (${a.symbol}, empty = none)`}
                      value={f.maxPerWallet}
                      onChange={(v) => setSleeve(a.symbol, { maxPerWallet: v })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={f.fixedEnabled} onChange={(e) => setSleeve(a.symbol, { fixedEnabled: e.target.checked })} />
                    Also offer a fixed-amount tier (like Alpha)
                  </label>
                  {f.fixedEnabled && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Input label={`Amounts (${a.symbol}, comma separated)`} value={f.fixedAmounts} onChange={(v) => setSleeve(a.symbol, { fixedAmounts: v })} />
                      <Input label="Multiplier on the base rate" value={f.fixedMult} onChange={(v) => setSleeve(a.symbol, { fixedMult: v })} />
                      <div>
                        <label className="label">Lock</label>
                        <select
                          className="input"
                          value={f.fixedLock}
                          onChange={(e) => setSleeve(a.symbol, { fixedLock: Number(e.target.value) })}
                        >
                          {form.locks.map((l, i) => (
                            <option key={i} value={i}>
                              #{i} · {l.months} months
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  <RewardTable sleeve={built.cfg.sleeves.find((s) => s.stakeToken === a.token)} locks={form.locks} decimals={token?.decimals ?? 18} sym={rSym} assetSym={a.symbol} unitLabel={f.unitAmount} />
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section n={4} title="Dates">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Deposits open</label>
            <input className="input" type="datetime-local" value={form.start} onChange={(e) => update({ ...form, start: e.target.value })} />
          </div>
          <div>
            <label className="label">Deposits close</label>
            <input className="input" type="datetime-local" value={form.end} onChange={(e) => update({ ...form, end: e.target.value })} />
          </div>
          <Input label="Epoch length (days)" value={form.epochDays} onChange={(v) => update({ ...form, epochDays: v })} />
        </div>
        <p className="text-xs text-slate-500">
          Before deposits open you can change both dates; afterwards you can only extend the close date. Stakes in the same epoch and lock
          share one Morpheus address.
        </p>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" checked={form.morBoost} onChange={(e) => update({ ...form, morBoost: e.target.checked })} />
          <span>
            MOR boost: lock each Capital Account&apos;s MOR claim until its earliest unlock. Morpheus pays more MOR, but you receive it at
            unlock instead of every few weeks. Contributors are not affected.
          </span>
        </label>
      </Section>

      <Section n={5} title="Reward budget">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={`Initial budget (${rSym})`} value={form.budget} onChange={(v) => update({ ...form, budget: v })} />
          <div className="pt-6 text-sm text-slate-400">
            Full cap{enabledAssets.length > 1 ? 's' : ''} at the best lock would reserve{' '}
            <span className="text-white">
              {fmt(built.fullCapReward, token?.decimals ?? 18)} {rSym}
            </span>
            .{' '}
            <button className="text-mor hover:underline" onClick={() => update({ ...form, budget: formatUnits(built.fullCapReward, token?.decimals ?? 18) })}>
              Use this
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Stakes are accepted only while the unreserved budget covers their full reward. You can top up any time and withdraw unreserved
          budget after deposits close.
        </p>
      </Section>

      <section className="card space-y-4">
        <h2 className="font-medium text-white">Review and create</h2>
        {built.errors.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-300">
            {built.errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {balanceShort && <p className="text-sm text-red-400">Your {rSym} balance is below the budget.</p>}
        <ol className="space-y-2 text-sm">
          {PHASES.map(([p, label], i) => {
            const idx = PHASES.findIndex(([x]) => x === phase);
            const state = created && p !== 'splitter' ? 'done' : phase === p ? (busy ? 'running' : 'failed') : idx > i ? 'done' : 'pending';
            return (
              <li key={p} className="flex items-center gap-2">
                <span className={state === 'done' ? 'text-mor' : state === 'running' ? 'text-amber-300' : state === 'failed' ? 'text-red-400' : 'text-slate-600'}>
                  {state === 'done' ? '✓' : state === 'running' ? '…' : state === 'failed' ? '!' : '○'}
                </span>
                <span className="text-slate-300">
                  {i + 1}. {label}
                </span>
              </li>
            );
          })}
        </ol>
        {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {created && phase !== 'done' && (
          <p className="text-sm text-slate-400">
            Pool created at <span className="mono">{created.vault}</span>. Finish by deploying its MOR splitter.
          </p>
        )}
        <button className="btn-primary" disabled={!canSubmit && !created} onClick={run}>
          {busy ? 'Waiting for wallet…' : created ? `Deploy MOR splitter on ${net.l2.name}` : 'Create pool'}
        </button>
        <p className="text-xs text-slate-500">
          Your wallet confirms up to three transactions: approve on {net.l1.name}, create on {net.l1.name}, splitter on {net.l2.name} (it
          switches chains for you). You need a little ETH on both.
        </p>
      </section>
    </div>
  );
}

function RewardTable(props: {
  sleeve?: ReturnType<typeof buildConfig>['cfg']['sleeves'][number];
  locks: PoolForm['locks'];
  decimals: number;
  sym: string;
  assetSym: string;
  unitLabel: string;
}) {
  const s = props.sleeve;
  if (!s || s.unit === 0n || s.ratePerUnit === 0n) return null;
  return (
    <table className="w-full text-xs">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 text-left font-normal">Lock</th>
          <th className="py-1 text-right font-normal">
            {props.sym} per {props.unitLabel} {props.assetSym} per year
          </th>
          <th className="py-1 text-right font-normal">over the lock</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-line text-slate-300">
        {props.locks.map((l, i) => {
          const dur = monthsToSeconds(Number(l.months) || 0);
          const bps = Math.round(Number(l.mult) * 10_000) || 0;
          const perYear = reward(s.unit, s.ratePerUnit, s.unit, bps, 365n * 86400n);
          const total = reward(s.unit, s.ratePerUnit, s.unit, bps, dur);
          return (
            <tr key={i}>
              <td className="py-1">
                {l.months} months · {l.mult}x
              </td>
              <td className="py-1 text-right">{fmt(perYear, props.decimals)}</td>
              <td className="py-1 text-right">{fmt(total, props.decimals)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4">
      <h2 className="font-medium text-white">
        {n} · {title}
      </h2>
      {children}
    </section>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ k, v, href }: { k: string; v: string; href: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd>
        <a className="mono break-all text-mor hover:underline" href={href} target="_blank" rel="noreferrer">
          {v}
        </a>
      </dd>
    </div>
  );
}
