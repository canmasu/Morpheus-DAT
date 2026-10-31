'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { deploy, errorText, write } from '@/lib/tx';
import { NETWORKS, explorerAddress, explorerTx, type NetworkName } from '@/config/networks';
import { useNetwork } from '@/components/Providers';
import { AdminGate } from '@/components/AdminGate';
import { HealthPanel } from '@/components/HealthPanel';
import {
  DEFAULT_PARAMS,
  STEPS,
  toDeploymentsJson,
  validateParams,
  type Ctx,
  type DeployParams,
  type DeployState,
  type Layer,
  type Step,
} from '@/lib/deployPlan';
import { download, load, remove, save } from '@/lib/storage';
import { short } from '@/lib/format';

const storageKey = (n: NetworkName) => `dat-deploy-${n}`;

export default function DeployPage() {
  return (
    <AdminGate>
      <Deploy />
    </AdminGate>
  );
}

function Deploy() {
  const { address } = useAccount();
  const { net, setNetwork } = useNetwork();
  const [state, setState] = useState<DeployState>({ network: net.name, params: DEFAULT_PARAMS(address), results: {} });
  const [running, setRunning] = useState<string>();
  const [error, setError] = useState<string>();
  const [mainnetAck, setMainnetAck] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRedo, setConfirmRedo] = useState<string>();

  useEffect(() => {
    setState(load<DeployState>(storageKey(net.name)) ?? { network: net.name, params: DEFAULT_PARAMS(address), results: {} });
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.name]);

  const persist = useCallback(
    (s: DeployState) => {
      const next = { ...s, updatedAt: new Date().toISOString() };
      setState(next);
      save(storageKey(net.name), next);
      return next;
    },
    [net.name],
  );

  const started = Object.keys(state.results).length > 0;
  const deployerMismatch = !!state.deployer && !!address && state.deployer.toLowerCase() !== address.toLowerCase();
  const paramErrors = validateParams(state.params);
  const blockReason = !address
    ? 'Connect the admin wallet.'
    : deployerMismatch
      ? `Connect ${short(state.deployer)}, the wallet that started this deployment.`
      : paramErrors.length > 0
        ? 'Fix the configuration above first.'
        : net.name === 'mainnet' && !mainnetAck
          ? 'Tick the mainnet confirmation above.'
          : undefined;
  const blocked = !!blockReason;

  const nextStep = STEPS.find((s) => !state.results[s.id]);

  /** Forgets this step and every later one, so they run again (e.g. after a contract fix). Earlier
   * contracts are kept and reused. */
  const redoFrom = (id: string) => {
    if (confirmRedo !== id) return setConfirmRedo(id);
    const from = STEPS.findIndex((s) => s.id === id);
    const keep = Object.fromEntries(STEPS.slice(0, from).filter((s) => state.results[s.id]).map((s) => [s.id, state.results[s.id]]));
    persist({ ...state, results: keep });
    setConfirmRedo(undefined);
  };
  const done = !nextStep;

  const ctxFor = useCallback(
    (s: DeployState): Ctx => {
      const chainOf = (layer: Layer) => (layer === 'l1' ? net.l1 : net.l2);
      const account = address as Address;
      return {
        net,
        deployer: account,
        params: s.params,
        results: s.results,
        deploy: (layer, artifact, args) => deploy(chainOf(layer), account, artifact, args),
        write: async (layer, target, abi, functionName, args) => ({
          hash: (await write(chainOf(layer), account, target, abi, functionName, args)).hash,
        }),
      };
    },
    [address, net],
  );

  const runStep = async (step: Step, s: DeployState) => {
    const ctx = ctxFor(s);
    if (step.skip?.(ctx)) return persist({ ...s, results: { ...s.results, [step.id]: { skipped: true } } });
    setRunning(step.id);
    const result = await step.run(ctx);
    return persist({ ...s, deployer: s.deployer ?? (address as Address), results: { ...s.results, [step.id]: result } });
  };

  const run = async (all: boolean) => {
    setError(undefined);
    let s: DeployState = { ...state, deployer: state.deployer ?? (address as Address) };
    try {
      for (const step of STEPS) {
        if (s.results[step.id]) continue;
        s = await runStep(step, s);
        if (!all && !s.results[step.id]?.skipped) break;
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(undefined);
    }
  };

  const setParam = <K extends keyof DeployParams>(k: K, v: DeployParams[K]) =>
    persist({ ...state, params: { ...state.params, [k]: v } });

  const deployments = useMemo(() => toDeploymentsJson(state, net), [state, net]);
  const groups = [...new Set(STEPS.map((s) => s.group))];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-mor">Admin</p>
          <h1 className="text-2xl font-semibold text-white">Deploy Morpheus DAT</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Runs the deployment from your wallet, Arbitrum first, then Ethereum. Your wallet will switch chains as needed.
            Progress is saved in this browser, so you can stop and resume.
          </p>
        </div>
        <div className="flex gap-2">
          {(Object.keys(NETWORKS) as NetworkName[]).map((n) => (
            <button
              key={n}
              disabled={!!running}
              onClick={() => setNetwork(n)}
              className={net.name === n ? 'btn-primary' : 'btn-ghost'}
            >
              {n === 'testnet' ? 'Testnet' : n === 'local' ? 'Sandbox' : 'Mainnet'}
            </button>
          ))}
        </div>
      </div>

      <section className="card space-y-4">
        <h2 className="font-medium text-white">1 · Configuration</h2>
        <p className="text-xs text-slate-400">
          {net.label}. Deployer and initial admin: <span className="mono text-slate-200">{address}</span>. Stake assets:{' '}
          {net.stakeAssets.map((a) => a.symbol).join(', ')}. MOR on {net.l2.name}: <span className="mono">{short(net.mor)}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DAT fee wallet" value={state.params.feeWallet} disabled={started} onChange={(v) => setParam('feeWallet', v)} />
          <Field label="Referral wallet (Morpheus referrer)" value={state.params.referral} disabled={started} onChange={(v) => setParam('referral', v)} />
          <div>
            <label className="label">DAT fee (bps, 1000 = 10%, cap 2000)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={2000}
              disabled={started}
              value={state.params.feeBps}
              onChange={(e) => setParam('feeBps', Number(e.target.value))}
            />
          </div>
          <Field label="Guardian (pause all, emergency exit)" value={state.params.guardian} onChange={(v) => setParam('guardian', v)} />
          <Field label="Pauser (pause deposits)" value={state.params.pauser} onChange={(v) => setParam('pauser', v)} />
          <Field label="Featurer (featured flags)" value={state.params.featurer} onChange={(v) => setParam('featurer', v)} />
          <Field
            label="Final admin Safe (optional, hand over at the end)"
            value={state.params.finalAdmin}
            placeholder="leave empty to keep your wallet as admin"
            onChange={(v) => setParam('finalAdmin', v)}
          />
        </div>
        {paramErrors.length > 0 && <ul className="text-sm text-red-400">{paramErrors.map((e) => <li key={e}>• {e}</li>)}</ul>}
        {deployerMismatch && (
          <p className="text-sm text-red-400">
            This deployment was started by {short(state.deployer)}. Connect that wallet to continue, or reset.
          </p>
        )}
        {net.name === 'mainnet' && (
          <label className="flex items-start gap-2 text-sm text-amber-300">
            <input type="checkbox" className="mt-1" checked={mainnetAck} onChange={(e) => setMainnetAck(e.target.checked)} />
            Mainnet uses real ETH. I confirm the launch gates are met: testnet exit criteria ticked, two audits closed.
          </label>
        )}
      </section>

      <section className="card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-white">2 · Contracts and setup</h2>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={blocked || done || !!running} onClick={() => run(false)}>
              {running ? 'Waiting for wallet…' : 'Run next step'}
            </button>
            <button className="btn-primary" disabled={blocked || done || !!running} onClick={() => run(true)}>
              Run all remaining
            </button>
          </div>
        </div>
        {blockReason && !running && <p className="text-sm text-amber-300">{blockReason}</p>}
        {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {groups.map((g) => (
          <div key={g}>
            <h3 className="label">{g}</h3>
            <ol className="divide-y divide-ink-line rounded-lg border border-ink-line">
              {STEPS.filter((s) => s.group === g).map((s) => {
                const r = state.results[s.id];
                const chain = s.layer === 'l1' ? net.l1 : net.l2;
                const status = r?.skipped ? 'skipped' : r ? 'done' : running === s.id ? 'running' : nextStep?.id === s.id ? 'next' : 'pending';
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StatusDot status={status} />
                      <div>
                        <div className="text-sm text-white">{s.title}</div>
                        <div className="text-xs text-slate-500">
                          {chain.name} · {s.detail}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3 text-xs">
                      {r?.address && (
                        <a className="mono text-mor hover:underline" target="_blank" rel="noreferrer" href={explorerAddress(chain, r.address)}>
                          {short(r.address)}
                        </a>
                      )}
                      {r?.hash && (
                        <a className="mono text-slate-400 hover:underline" target="_blank" rel="noreferrer" href={explorerTx(chain, r.hash)}>
                          tx
                        </a>
                      )}
                      {r?.skipped && <span className="text-slate-500">skipped</span>}
                      {r && !running && (
                        <button className="text-slate-500 hover:text-amber-300" onClick={() => redoFrom(s.id)}>
                          {confirmRedo === s.id ? 'click again: redo this and later steps' : 'redo from here'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>

      {state.results.poolFactory?.address && <HealthPanel deployments={deployments} />}

      <section className="card space-y-3">
        <h2 className="font-medium text-white">3 · Save the address list</h2>
        <p className="text-sm text-slate-400">
          Download <span className="mono">{net.name}.json</span> and commit it as{' '}
          <span className="mono">web/src/deployments/{net.name}.json</span> so the site, indexer and /contracts use it.
        </p>
        <pre className="max-h-72 overflow-auto rounded-lg bg-ink p-3 text-xs text-slate-300">{JSON.stringify(deployments, null, 2)}</pre>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!started} onClick={() => download(`${net.name}.json`, deployments)}>
            Download {net.name}.json
          </button>
          <button
            className="btn-ghost text-red-300"
            disabled={!started || !!running}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              remove(storageKey(net.name));
              setState({ network: net.name, params: DEFAULT_PARAMS(address), results: {} });
              setConfirmReset(false);
            }}
          >
            {confirmReset ? 'Click again to forget this progress' : 'Reset progress'}
          </button>
        </div>
        <p className="text-xs text-slate-500">Reset only clears this browser&apos;s record. Deployed contracts stay on-chain.</p>
      </section>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="label">{props.label}</label>
      <input
        className="input"
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder ?? '0x…'}
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value.trim())}
      />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'done'
      ? 'bg-mor'
      : status === 'running'
        ? 'animate-pulse bg-amber-400'
        : status === 'next'
          ? 'border border-mor bg-transparent'
          : status === 'skipped'
            ? 'bg-slate-600'
            : 'bg-ink-line';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}
