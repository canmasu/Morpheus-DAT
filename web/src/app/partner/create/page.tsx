'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, isAddress, type Address } from 'viem';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { explorerAddress } from '@/config/networks';
import { applyExamplePool, buildConfig, defaultForm, monthsToSeconds, reward, type PoolForm, type SleeveForm } from '@/lib/pool';
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
  const minLockMonths = (((Number(form.epochDays) || 0) + 30) * 12) / 365;
  const applyQuickTest = () => update({ ...form, epochDays: '1', locks: [{ months: '1.1', mult: '1.00' }], morBoost: false });
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
        <Help>
          <p>
            How long contributors can lock their stake, and how much extra reward each lock earns. The multiplier scales the base rate you
            set in step 3: <b>1.00x</b> = the base rate, <b>2.50x</b> = 2.5 times the base rate per year.
          </p>
          <p>
            Shortest allowed lock right now: <b>{minLockMonths.toFixed(1)} months</b> (epoch length in step 4 + 30 days), because the pool
            takes each stake back out of Morpheus 30 days before it unlocks. 12 months = 365 days.
          </p>
        </Help>
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
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/5 p-3 text-xs text-slate-300">
          <span>
            Example from the proposal, for every asset: <b>Alpha</b> from $100 (brackets $100 / $1k / $10k / $100k, 12 months) and{' '}
            <b>Omega</b> ($1M – $10M per wallet, 12 – 60 months), 20,000 tokens per $1M per year. stETH amounts count 1 stETH as
            $1,000{net.name === 'testnet' ? '; on testnet LINK counts as 1 USDC' : ''}. Contributors see Alpha $100 as 1x and Omega 12
            months as 20x.
          </span>
          <button className="btn-ghost" onClick={() => update(applyExamplePool(form, net))}>
            Fill Example pool
          </button>
        </div>
        <Help>
          <p>
            Pick what contributors can stake and how much of your token they earn. The rate is per year at 1.00x: e.g. <b>20,000 per year
            for every 1,000,000 USDC</b> means $1M staked for 12 months at 1.00x earns 20,000 tokens. The table under each asset shows the
            exact amount for every lock.
          </p>
          <p>
            <b>Pool cap</b>: most that can be staked in this asset in total. <b>Min per stake</b>: smallest single stake.{' '}
            <b>Max per wallet</b>: most one wallet can have staked at once (leave empty for no limit). These three make the Omega tier
            (any amount in range, contributor picks the lock). The Alpha tier below covers smaller stakes on one lock.
          </p>
        </Help>
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
                    Also offer the Alpha tier for smaller stakes (amount brackets, each with its own multiplier, one lock)
                  </label>
                  {f.fixedEnabled && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input label={`Bracket starts (${a.symbol}, ascending)`} value={f.fixedAmounts} onChange={(v) => setSleeve(a.symbol, { fixedAmounts: v })} />
                      <Input label="Multiplier per bracket (or one for all)" value={f.fixedMult} onChange={(v) => setSleeve(a.symbol, { fixedMult: v })} />
                      <Input label={`Max per stake (${a.symbol}, empty = none)`} value={f.fixedMax} onChange={(v) => setSleeve(a.symbol, { fixedMax: v })} />
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

      <Section n={4} title="Dates, epochs and MOR timing">
        {net.name !== 'mainnet' && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sky-500/10 p-3 text-xs text-sky-200">
            <span>Testing? Use settings that let you reach unlock and withdraw in about 5 weeks.</span>
            <button className="btn-ghost" onClick={applyQuickTest}>
              Quick test settings
            </button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Deposits open</label>
            <input className="input" type="datetime-local" value={form.start} onChange={(e) => update({ ...form, start: e.target.value })} />
          </div>
          <div>
            <label className="label">Deposits close</label>
            <input className="input" type="datetime-local" value={form.end} onChange={(e) => update({ ...form, end: e.target.value })} />
          </div>
        </div>
        <Help>
          <p>
            The window when contributors can stake. After it closes, no new stakes; existing stakes keep earning until their own unlock, and
            you can take back any budget nobody reserved. Before deposits open you can change both dates; after that you can only extend
            the close date.
          </p>
        </Help>

        <div className="max-w-xs">
          <Input label="Epoch length (days)" value={form.epochDays} onChange={(v) => update({ ...form, epochDays: v })} />
        </div>
        <Help>
          <p>
            Morpheus restarts its waiting times (7 days before a withdraw, 14 days before a MOR claim) every time an address receives a
            new stake. If the whole pool used one address, each new stake would delay MOR and withdrawals for everyone.
          </p>
          <p>
            So the pool groups stakes: everyone who stakes in the same {form.epochDays || '30'}-day period with the same lock shares one
            Morpheus address. Example: Alice stakes on 5 Nov and Bob on 20 Nov, both for 12 months: same group. Carol stakes in December,
            or picks 24 months: a new group. Once a period ends, its group is never restaked into, so its MOR can be claimed and its
            staked tokens returned on time. Contributors never see this.
          </p>
          <p>
            <b>30 days</b> for real pools (fewer groups, fewer MOR claims). <b>1 day</b> for testing (allows locks as short as 1.1
            months).
          </p>
        </Help>

        <div className="space-y-2">
          <label className="label">How you receive MOR</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [true, 'MOR boost: more MOR, later', 'Each group\'s MOR claim is locked until its earliest unlock (e.g. 12 months). Morpheus pays a higher MOR multiplier for this lock. You receive MOR in one amount at unlock.'],
              [false, 'Regular: MOR every ~2 weeks', 'MOR can be claimed as it builds up, about every 14 days after a group stops taking stakes. Normal Morpheus rate.'],
            ].map(([value, title, text]) => (
              <button
                key={String(value)}
                onClick={() => update({ ...form, morBoost: value as boolean })}
                className={`rounded-lg border p-3 text-left text-xs ${form.morBoost === value ? 'border-mor bg-mor/10' : 'border-ink-line hover:border-slate-500'}`}
              >
                <div className="mb-1 text-sm font-medium text-white">
                  {form.morBoost === value ? '● ' : '○ '}
                  {title as string}
                </div>
                <div className="text-slate-400">{text as string}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">Contributors are not affected either way: their reward and unlock date are the same.</p>
        </div>
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
        <Help>
          <p>
            The {rSym} you put in the pool now. Every stake reserves its full reward from this budget the moment it is made, so a stake is
            only accepted while enough unreserved budget is left. You can top up any time, and take back whatever is still unreserved
            after deposits close. Reserved rewards can never be taken back.
          </p>
        </Help>
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

function Help({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 text-xs leading-relaxed text-slate-400">{children}</div>;
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
