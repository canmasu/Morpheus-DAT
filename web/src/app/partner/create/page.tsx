'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { baseNet, explorerAddress, poolNet } from '@/config/networks';
import { applyExamplePool, buildConfig, defaultForm, fmtMult, reward, YEAR, type PoolForm, type SleeveForm } from '@/lib/pool';
import { TokenIcon } from '@/components/TokenIcon';
import { fmtCompact } from '@/lib/format';
import { AddToWallet } from '@/components/AddToWallet';
import { morClaimLockMultiplier } from '@/lib/mor';
import { approveIfNeeded, contractsFor, createBuilderPool, createPool, createTestToken, deploySplitter, subnetCreationFee, subnetNameTaken, tokenInfo } from '@/lib/partner';
import { errorText } from '@/lib/tx';
import { load, save } from '@/lib/storage';
import { useChainNow } from '@/hooks/useChainNow';

type Token = Awaited<ReturnType<typeof tokenInfo>>;
type Phase = 'form' | 'approve' | 'create' | 'splitter' | 'done';

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function CreatePoolPage() {
  const { address, isConnected } = useAccount();
  const { net: root } = useNetwork();
  const baseView = baseNet(root);
  const [onBase, setOnBase] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('c') === 'base') setOnBase(true);
  }, []);
  const net = poolNet(root, onBase);
  const { factory, splitterDeployer } = contractsFor(net);
  const PHASES: [Phase, string][] = [
    ['approve', 'Approve the reward budget'],
    ['create', `Create the pool on ${net.l1.name}`],
    ['splitter', `Deploy the MOR splitter on ${net.l2.name}`],
  ];
  // v2: base rate at 1x and multipliers as shown; drafts saved in the older scale are not loaded.
  const draftKey = `dat-pool-draft-v3-${net.name}${onBase ? '-base' : ''}`;
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
  const [testToken, setTestToken] = useState({ name: 'Test Token', symbol: 'TEST', supply: '42,000,000' });
  const [subnet, setSubnet] = useState({ name: '', description: '', website: '', image: '' });
  const [subnetFee, setSubnetFee] = useState<bigint>();
  const [nameTaken, setNameTaken] = useState(false);

  useEffect(() => {
    setMounted(true);
    const draft = load<PoolForm>(draftKey);
    const base = defaultForm(net, chainNowMs);
    // Dates always start fresh; everything else comes from the saved draft.
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    setForm({ ...(draft ? { ...base, ...draft, start: base.start, end: base.end } : base), ...(fromUrl ? { rewardToken: fromUrl } : {}) });
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

  useEffect(() => {
    setSubnetFee(undefined);
    if (onBase) subnetCreationFee(net).then(setSubnetFee, () => setSubnetFee(undefined));
  }, [net, onBase]);

  const subnetName = subnet.name.trim();
  useEffect(() => {
    setNameTaken(false);
    if (!onBase || !subnetName) return;
    const timer = setTimeout(() => subnetNameTaken(net, subnetName).then(setNameTaken, () => {}), 400);
    return () => clearTimeout(timer);
  }, [net, onBase, subnetName]);

  const built = useMemo(() => buildConfig(form, net, token?.decimals, chainNowMs), [form, net, token?.decimals, chainNowMs]);
  const balanceShort = token && built.budget > token.balance;
  const subnetReady = !onBase || (!!subnetName && !nameTaken && subnetFee !== undefined);
  const canSubmit = isConnected && factory && splitterDeployer && built.errors.length === 0 && !balanceShort && subnetReady && !busy;

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
        if (onBase) {
          if (subnetFee) await approveIfNeeded(net, address, net.mor, factory, subnetFee);
          pool = await createBuilderPool(net, address, factory, built.cfg, built.budget, subnetName, {
            slug: subnetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            description: subnet.description.trim(),
            website: subnet.website.trim(),
            image: subnet.image.trim(),
          });
        } else {
          pool = await createPool(net, address, factory, built.cfg, built.budget);
        }
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
      const t = await createTestToken(net, address, testToken.name.trim(), testToken.symbol.trim(), testToken.supply);
      update({ ...form, rewardToken: t });
      setTokenTick((x) => x + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  const chainPicker = baseView && (
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        [false, `${root.l1.name}: stETH and stablecoins`, `Staked in Morpheus Capital. MOR reaches you on ${root.l2.name}.`],
        [true, `${baseView.l1.name}: MOR`, 'Staked in your own Morpheus Builders subnet. MOR reaches you on Base.'],
      ].map(([value, title, text]) => (
        <button
          key={String(value)}
          onClick={() => {
            setOnBase(value as boolean);
            setCreated(undefined);
            setPhase('form');
            setError(undefined);
          }}
          className={`rounded-xl border p-3 text-left ${onBase === value ? 'border-mor bg-mor/10' : 'border-ink-line hover:border-slate-500'}`}
        >
          <div className="text-sm font-medium text-white">{title as string}</div>
          <div className="mt-1 text-xs text-slate-400">{text as string}</div>
        </button>
      ))}
    </div>
  );

  if (!factory) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {chainPicker}
        <p className="card text-sm text-amber-300">Morpheus DAT is not deployed on {net.label} yet.</p>
      </div>
    );
  }

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

  // The form follows the chain one effect later; until then it has no entry for this chain's assets.
  if (net.stakeAssets.some((a) => !form.sleeves[a.symbol])) return null;

  const enabledAssets = net.stakeAssets.filter((a) => form.sleeves[a.symbol]?.enabled);
  const minLockMonths = (((Number(form.epochDays) || 0) + 30) * 12) / 365;
  const rSym = token?.symbol ?? 'tokens';
  const rDec = token?.decimals ?? 18;

  // Multipliers as farmers will see them: relative to the lowest one in the pool.
  const toBps = (m: string) => Math.round(Number(m) * 10_000);
  const allBps = [
    ...form.locks.map((l) => toBps(l.mult)),
    ...enabledAssets.flatMap((a) => (form.sleeves[a.symbol].fixedEnabled ? splitList(form.sleeves[a.symbol].fixedMult).map(toBps) : [])),
  ].filter((b) => b > 0);
  const base = Math.min(10_000, ...(allBps.length ? allBps : [10_000]));
  const range = allBps.length ? `${fmtMult(Math.min(...allBps), base)} – ${fmtMult(Math.max(...allBps), base)}` : '—';

  const applyQuickTest = () =>
    update({
      ...form,
      epochDays: '1',
      locks: [{ months: '1.1', mult: '20' }],
      morBoost: false,
      sleeves: Object.fromEntries(Object.entries(form.sleeves).map(([k, v]) => [k, { ...v, fixedLock: 0 }])),
    });
  // Morpheus's MOR multiplier for a claim lock as long as each Whale lock, starting at deposit open.
  const startSec = Math.floor(new Date(form.start).getTime() / 1000) || Math.floor(chainNowMs / 1000);
  const boosts = form.locks
    .map((l) => ({ months: l.months, x: morClaimLockMultiplier(startSec, startSec + Math.round((Number(l.months) * 365 * 86400) / 12)) }))
    .filter((b) => Number(b.months) > 0);
  const boostRange = boosts.length
    ? boosts.map((b) => `×${b.x.toFixed(1)} (${b.months}m)`).join(', ')
    : '×1 – ×10.7 depending on the lock';
  const builtSleeve = (token: Address) => built.cfg.sleeves.find((x) => x.stakeToken === token);
  // Lock table: Months · Multiplier · Shown · one column per enabled asset · remove
  const lockCols = `80px 96px repeat(${Math.max(1, enabledAssets.length)}, minmax(0, 1fr)) 24px`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/partner/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Partners
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Create a pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Fund a pool with your token. Farmers farm with {onBase ? 'MOR' : 'stETH or stablecoins'}, get their full stake back at unlock, and receive your token; you receive MOR.
        </p>
      </div>

      {chainPicker}

      {!isConnected && (
        <div className="card flex items-center justify-between">
          <span className="text-sm text-slate-400">Connect the wallet that will own the pool and receive MOR.</span>
          <ConnectButton />
        </div>
      )}

      {/* templates */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Template
          title="Example pool"
          text="OG from $100 (1x – 5x, 12 months) + Whale $1M – $10M (20x – 50x, 12 – 60 months)"
          onClick={() => update(applyExamplePool(form, net))}
        />
        {net.name !== 'mainnet' && (
          <Template title="Quick test" text="One 1.1-month lock, 1-day epoch, MOR every ~2 weeks. Withdraw in about 5 weeks." onClick={applyQuickTest} />
        )}
        <Template title="Start over" text="Reset everything to the defaults." onClick={() => update({ ...defaultForm(net, chainNowMs), rewardToken: form.rewardToken })} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {/* 1 · reward token */}
          {onBase && (
            <Card n={0} title="Your Morpheus Builders subnet">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Subnet name (cannot change later)</label>
                  <input className="input" value={subnet.name} placeholder="My Project" onChange={(e) => setSubnet({ ...subnet, name: e.target.value })} />
                  {nameTaken && <p className="mt-1 text-xs text-red-400">This name is already taken on Morpheus Builders.</p>}
                </div>
                <div>
                  <label className="label">Website</label>
                  <input className="input" value={subnet.website} placeholder="https://" onChange={(e) => setSubnet({ ...subnet, website: e.target.value })} />
                </div>
                <div>
                  <label className="label">Description</label>
                  <input className="input" value={subnet.description} onChange={(e) => setSubnet({ ...subnet, description: e.target.value })} />
                </div>
                <div>
                  <label className="label">Logo URL</label>
                  <input className="input" value={subnet.image} placeholder="https://" onChange={(e) => setSubnet({ ...subnet, image: e.target.value })} />
                </div>
              </div>
              <Why>
                <p>
                  The pool creates its own subnet, so you are listed as a builder on Morpheus. Every MOR staked here earns MOR for the subnet,
                  and the pool sends it to your splitter: the DAT fee, then you. The pool stays the subnet&apos;s admin, so nobody can redirect
                  the MOR or extend the withdraw lock. You can edit the listing later.
                </p>
                {!!subnetFee && (
                  <p>
                    Morpheus charges {fmt(subnetFee, 18)} MOR to create a subnet. You need it in this wallet, on {net.l1.name}.
                  </p>
                )}
              </Why>
            </Card>
          )}

          <Card n={1} title="Reward token">
            <p className="mb-3 text-xs text-slate-400">
              Token on another chain?{' '}
              <Link className="text-mor hover:underline" href="/partner/bridge/">
                Bring it to {net.l1.name} →
              </Link>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="input min-w-0 flex-1"
                placeholder="OG Token address (0x…)"
                value={form.rewardToken}
                disabled={!!created}
                onChange={(e) => update({ ...form, rewardToken: e.target.value.trim() })}
              />
              {token && (
                <span className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3 text-sm text-white">
                  <TokenIcon symbol={token.symbol} reward size={22} />
                  {token.symbol}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              {token ? (
                <>
                  <span className="text-slate-400">
                    Your balance <span className="text-white">{fmt(token.balance, token.decimals)}</span> {token.symbol}
                  </span>
                  <AddToWallet chain={net.l1} token={form.rewardToken as Address} symbol={token.symbol} decimals={token.decimals} />
                </>
              ) : isAddress(form.rewardToken) ? (
                <span className="text-red-400">Not an ERC-20 token on {net.l1.name}.</span>
              ) : null}
            </div>
            {net.name !== 'mainnet' && isConnected && !created && !token && (
              <div className="mt-4 rounded-xl bg-ink p-3">
                <div className="mb-2 text-xs text-slate-400">No token yet? Create a test token (testnet only, you can mint more later):</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] text-slate-500">
                    Name
                    <input className="input mt-1 w-44" value={testToken.name} onChange={(e) => setTestToken({ ...testToken, name: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Symbol
                    <input
                      className="input mt-1 w-28 uppercase"
                      maxLength={11}
                      value={testToken.symbol}
                      onChange={(e) => setTestToken({ ...testToken, symbol: e.target.value.replace(/\s/g, '') })}
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Supply (to you)
                    <input className="input mt-1 w-36" value={testToken.supply} onChange={(e) => setTestToken({ ...testToken, supply: e.target.value })} />
                  </label>
                  <button
                    className="btn-primary"
                    disabled={busy || !testToken.name.trim() || !testToken.symbol.trim() || !/^[\d,_ ]+$/.test(testToken.supply)}
                    onClick={makeTestToken}
                  >
                    {busy ? 'Confirm in wallet…' : `Create ${testToken.symbol || 'token'}`}
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* 2 · assets and tiers */}
          <Card n={2} title="What farmers can stake">
            <div className="space-y-4">
              {net.stakeAssets.map((a) => {
                const f = form.sleeves[a.symbol];
                if (!f) return null;
                const bs = builtSleeve(a.token);
                const alphaAmounts = splitList(f.fixedAmounts);
                const alphaMults = splitList(f.fixedMult);
                const alphaTier = bs?.tiers.find((t) => t.kind === 2);
                const setAlpha = (amounts: string[], mults: string[]) =>
                  setSleeve(a.symbol, { fixedAmounts: amounts.join(', '), fixedMult: mults.join(', ') });
                return (
                  <div key={a.symbol} className={`rounded-xl border p-4 ${f.enabled ? 'border-ink-line' : 'border-dashed border-ink-line opacity-70'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <TokenIcon symbol={a.symbol} size={30} />
                        <span className="font-medium text-white">{a.symbol}</span>
                      </div>
                      <Toggle on={f.enabled} onChange={(v) => setSleeve(a.symbol, { enabled: v })} label={`Accept ${a.symbol}`} />
                    </div>

                    {f.enabled && (
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                          <span>At 1x, 1 {a.symbol} earns</span>
                          <input className="input w-32" value={f.perToken} onChange={(e) => setSleeve(a.symbol, { perToken: e.target.value })} />
                          <span>{rSym} per year</span>
                        </div>
                        {bs && bs.ratePerUnit > 0n && (
                          <p className="-mt-2 text-xs text-slate-500">
                            e.g. {fmt(refAmount(f, a.decimals), a.decimals)} {a.symbol} at {fmtMult(Math.max(...form.locks.map((l) => toBps(l.mult)), 10_000), 10_000)}{' '}
                            for a year ={' '}
                            <span className="text-slate-300">
                              {fmt(reward(refAmount(f, a.decimals), bs.ratePerUnit, bs.unit, Math.max(...form.locks.map((l) => toBps(l.mult)), 10_000), YEAR), rDec)} {rSym}
                            </span>
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                          <span>Pool cap:</span>
                          <input className="input w-36" value={f.cap} onChange={(e) => setSleeve(a.symbol, { cap: e.target.value })} />
                          <span>{a.symbol} in total</span>
                        </div>

                        {/* OG */}
                        <div className="rounded-lg bg-ink p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-white">OG · smaller stakes</div>
                              <div className="text-xs text-slate-500">Any amount from the first bracket; multiplier by bracket; one lock</div>
                            </div>
                            <Toggle on={f.fixedEnabled} onChange={(v) => setSleeve(a.symbol, { fixedEnabled: v })} label="OG" />
                          </div>
                          {f.fixedEnabled && (
                            <div className="mt-3 space-y-2">
                              <div className="grid grid-cols-[1fr_96px_1fr_24px] items-center gap-2 text-[11px] text-slate-500">
                                <span>Stake from ({a.symbol})</span>
                                <span>Multiplier (x)</span>
                                <span className="text-right">Per year at that amount</span>
                                <span />
                              </div>
                              {alphaAmounts.map((amt, i) => (
                                <div key={i} className="grid grid-cols-[1fr_96px_1fr_24px] items-center gap-2">
                                  <input
                                    className="input"
                                    value={amt}
                                    onChange={(e) => setAlpha(alphaAmounts.map((x, j) => (j === i ? e.target.value : x)), alphaMults)}
                                  />
                                  <input
                                    className="input"
                                    value={alphaMults[i] ?? ''}
                                    onChange={(e) => setAlpha(alphaAmounts, alphaAmounts.map((_, j) => (j === i ? e.target.value : (alphaMults[j] ?? ''))))}
                                  />
                                  <span className="text-right text-sm text-slate-300">
                                    {alphaTier && bs && alphaTier.amounts[i] !== undefined
                                      ? `${fmt(reward(alphaTier.amounts[i], bs.ratePerUnit, bs.unit, alphaTier.multBps[i], YEAR), rDec)} ${rSym}`
                                      : '—'}
                                  </span>
                                  <IconButton
                                    title="Remove bracket"
                                    onClick={() => setAlpha(alphaAmounts.filter((_, j) => j !== i), alphaMults.filter((_, j) => j !== i))}
                                  />
                                </div>
                              ))}
                              <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-slate-300">
                                <button
                                  className="text-xs text-mor hover:underline"
                                  onClick={() => setAlpha([...alphaAmounts, ''], [...alphaAmounts.map((_, j) => alphaMults[j] ?? ''), ''])}
                                >
                                  + Add bracket
                                </button>
                                <span className="ml-auto flex items-center gap-2">
                                  Lock
                                  <select
                                    className="input w-auto py-1.5"
                                    value={f.fixedLock}
                                    onChange={(e) => setSleeve(a.symbol, { fixedLock: Number(e.target.value) })}
                                  >
                                    {form.locks.map((l, i) => (
                                      <option key={i} value={i}>
                                        {l.months} months
                                      </option>
                                    ))}
                                  </select>
                                </span>
                                <span className="flex items-center gap-2">
                                  Max per stake
                                  <input
                                    className="input w-36 py-1.5"
                                    placeholder="no max"
                                    value={f.fixedMax}
                                    onChange={(e) => setSleeve(a.symbol, { fixedMax: e.target.value })}
                                  />
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Whale */}
                        <div className="rounded-lg bg-ink p-3">
                          <div className="text-sm font-medium text-white">Whale · larger stakes</div>
                          <div className="text-xs text-slate-500">Any amount in this range; the farmer picks a lock (step 3)</div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                            <span>From</span>
                            <input className="input w-36" value={f.minPerWallet} onChange={(e) => setSleeve(a.symbol, { minPerWallet: e.target.value })} />
                            <span>per stake, up to</span>
                            <input
                              className="input w-36"
                              placeholder="no max"
                              value={f.maxPerWallet}
                              onChange={(e) => setSleeve(a.symbol, { maxPerWallet: e.target.value })}
                            />
                            <span>{a.symbol} per wallet</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 3 · locks */}
          <Card n={3} title="Whale lock options">
            <p className="-mt-2 mb-3 text-xs text-slate-500">
              Shared by every asset&apos;s Whale tier
              {enabledAssets.length > 0 ? ` (${enabledAssets.map((a) => a.symbol).join(', ')})` : ''}. OG uses one of these locks.
            </p>
            <div className="grid items-end gap-2 text-[11px] text-slate-500" style={{ gridTemplateColumns: lockCols }}>
              <span>Months</span>
              <span>Multiplier (x)</span>
              {enabledAssets.length === 0 && <span className="text-right">Per year</span>}
              {enabledAssets.map((a) => (
                <span key={a.symbol} className="flex items-center justify-end gap-1.5 text-right">
                  <TokenIcon symbol={a.symbol} size={14} />
                  <span>
                    per {fmtCompact(refAmount(form.sleeves[a.symbol], a.decimals), a.decimals)} {a.symbol} / yr
                  </span>
                </span>
              ))}
              <span />
            </div>
            <div className="mt-1 space-y-2">
              {form.locks.map((l, i) => {
                return (
                  <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: lockCols }}>
                    <input
                      className="input"
                      value={l.months}
                      onChange={(e) => update({ ...form, locks: form.locks.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)) })}
                    />
                    <input
                      className="input"
                      value={l.mult}
                      onChange={(e) => update({ ...form, locks: form.locks.map((x, j) => (j === i ? { ...x, mult: e.target.value } : x)) })}
                    />
                    {enabledAssets.length === 0 && <span className="text-right text-sm text-slate-500">—</span>}
                    {enabledAssets.map((a) => {
                      const bs = builtSleeve(a.token);
                      return (
                        <span key={a.symbol} className="text-right text-sm text-slate-300">
                          {bs && bs.unit > 0n
                            ? `${fmt(reward(refAmount(form.sleeves[a.symbol], a.decimals), bs.ratePerUnit, bs.unit, toBps(l.mult), YEAR), rDec)} ${rSym}`
                            : '—'}
                        </span>
                      );
                    })}
                    <IconButton title="Remove lock" onClick={() => update({ ...form, locks: form.locks.filter((_, j) => j !== i) })} />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button className="text-xs text-mor hover:underline" onClick={() => update({ ...form, locks: [...form.locks, { months: '12', mult: '20' }] })}>
                + Add lock
              </button>
              <span className="text-xs text-slate-500">Shortest allowed: {minLockMonths.toFixed(1)} months (epoch + 30 days)</span>
            </div>
          </Card>

          {/* 4 · timing */}
          <Card n={4} title="Dates and MOR">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Deposits open</label>
                <input className="input" type="datetime-local" value={form.start} onChange={(e) => update({ ...form, start: e.target.value })} />
              </div>
              <div>
                <label className="label">Deposits close</label>
                <input className="input" type="datetime-local" value={form.end} onChange={(e) => update({ ...form, end: e.target.value })} />
              </div>
              <div>
                <label className="label">Epoch (days)</label>
                <input className="input" value={form.epochDays} onChange={(e) => update({ ...form, epochDays: e.target.value })} />
              </div>
            </div>
            <Why>
              <p>
                <b>Deposits open/close</b>: the window to stake. Before it opens you can change both dates; after, you can only extend the
                close date.
              </p>
              <p>
                <b>Epoch</b>: Morpheus restarts its waiting times every time an address receives a stake, so the pool groups stakes made
                in the same {form.epochDays || '30'}-day period with the same lock into one Morpheus address. Use 30 days for real pools,
                1 day for testing. Farmers never see this.
              </p>
            </Why>
            {!onBase && <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                [false, 'MOR every ~2 weeks (recommended)', 'Claim MOR as it builds up: about 14 days after each 30-day group closes, then every 14 days (Morpheus’s own minimum). Normal Morpheus rate.'],
                [
                  true,
                  'MOR boost: lock the MOR claim for more MOR',
                  `Morpheus rewards locking the MOR claim (not the stake): each group promises not to claim until its unlock, and Morpheus multiplies its MOR share by about ${boostRange}. MOR then arrives in one amount at each group’s unlock. Cannot be undone after staking.`,
                ],
              ].map(([value, title, text]) => (
                <button
                  key={String(value)}
                  onClick={() => update({ ...form, morBoost: value as boolean })}
                  className={`rounded-xl border p-3 text-left ${form.morBoost === value ? 'border-mor bg-mor/10' : 'border-ink-line hover:border-slate-500'}`}
                >
                  <div className="text-sm font-medium text-white">
                    {form.morBoost === value ? '● ' : '○ '}
                    {title as string}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{text as string}</div>
                </button>
              ))}
            </div>}
          </Card>

          {/* 5 · budget */}
          <Card n={5} title="Reward budget">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <input className="input w-44" value={form.budget} onChange={(e) => update({ ...form, budget: e.target.value })} />
              <span>{rSym}</span>
              <button
                className="ml-auto text-xs text-mor hover:underline"
                onClick={() => update({ ...form, budget: formatUnits(built.fullCapReward, rDec) })}
              >
                Use {fmt(built.fullCapReward, rDec)} (covers every cap at the best lock)
              </button>
            </div>
            <Why>
              <p>
                Each stake reserves its full reward from this budget when it is made, so stakes are accepted only while enough is left. Top
                up any time; take back the unreserved part after deposits close.
              </p>
            </Why>
          </Card>
        </div>

        {/* summary */}
        <aside className="h-fit space-y-4 rounded-2xl border border-ink-line bg-ink-soft p-5 lg:sticky lg:top-6">
          <h2 className="text-lg font-semibold text-white">Summary</h2>
          <div className="space-y-2 text-sm">
            <SumRow k="Reward token">{token ? token.symbol : '—'}</SumRow>
            <SumRow k="Multipliers">{range}</SumRow>
            {enabledAssets.map((a) => {
              const f = form.sleeves[a.symbol];
              return (
                <SumRow key={a.symbol} k={a.symbol}>
                  <span className="flex items-center gap-1.5">
                    <TokenIcon symbol={a.symbol} size={16} />
                    {f.fixedEnabled ? 'OG + Whale' : 'Whale'}
                  </span>
                </SumRow>
              );
            })}
            <SumRow k="Locks">{form.locks.map((l) => l.months).join(' / ')} months</SumRow>
            <SumRow k="MOR">{onBase ? 'Any time, on Base' : form.morBoost ? 'More, later (boost)' : 'Every ~2 weeks'}</SumRow>
            <SumRow k="Budget">
              {form.budget || '—'} {rSym}
            </SumRow>
          </div>

          {built.errors.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
              {built.errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
          {balanceShort && <p className="text-xs text-red-400">Your {rSym} balance is below the budget.</p>}

          <ol className="space-y-1.5 text-xs">
            {PHASES.map(([p, label], i) => {
              const idx = PHASES.findIndex(([x]) => x === phase);
              const st = created && p !== 'splitter' ? 'done' : phase === p ? (busy ? 'running' : 'failed') : idx > i ? 'done' : 'pending';
              return (
                <li key={p} className="flex items-center gap-2">
                  <span className={st === 'done' ? 'text-mor' : st === 'running' ? 'text-amber-300' : st === 'failed' ? 'text-red-400' : 'text-slate-600'}>
                    {st === 'done' ? '✓' : st === 'running' ? '…' : st === 'failed' ? '!' : '○'}
                  </span>
                  <span className="text-slate-300">{label}</span>
                </li>
              );
            })}
          </ol>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
          {created && phase !== 'done' && (
            <p className="text-xs text-slate-400">
              Pool created at <span className="mono">{created.vault}</span>. Finish by deploying its MOR splitter.
            </p>
          )}
          <button
            className="w-full rounded-full bg-mor py-3.5 text-sm font-semibold text-ink transition hover:bg-mor/90 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
            disabled={!canSubmit && !created}
            onClick={run}
          >
            {busy ? 'Confirm in your wallet…' : created ? `Deploy MOR splitter on ${net.l2.name}` : 'Create pool'}
          </button>
          <p className="text-xs text-slate-500">
            Up to three confirmations: approve and create on {net.l1.name}, then the splitter on {net.l2.name}.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Amount used for example figures: the Whale minimum, or 1 token. */
function refAmount(f: SleeveForm, decimals: number) {
  try {
    const min = parseUnits((f.minPerWallet || '0').replace(/,/g, ''), decimals);
    return min > 0n ? min : 10n ** BigInt(decimals);
  } catch {
    return 10n ** BigInt(decimals);
  }
}

const splitList = (s: string) => (s.trim() === '' ? [] : s.split(',').map((x) => x.trim()));

function Card({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-line bg-ink-soft p-5">
      <h2 className="mb-4 flex items-center gap-2 font-medium text-white">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mor/10 text-xs font-semibold text-mor">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Template({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-ink-line bg-ink-soft p-4 text-left transition hover:border-mor/50">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{text}</div>
    </button>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-mor' : 'bg-white/10'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function IconButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-white/5 hover:text-red-300">
      ×
    </button>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-3 text-xs text-slate-400">
      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Why?</summary>
      <div className="mt-2 space-y-1.5 leading-relaxed">{children}</div>
    </details>
  );
}

function SumRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="text-right text-slate-200">{children}</span>
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
