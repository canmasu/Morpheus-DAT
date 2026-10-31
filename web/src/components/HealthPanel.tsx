'use client';

import { useEffect, useState } from 'react';
import { getPublicClient } from 'wagmi/actions';
import { type Address, zeroAddress } from 'viem';
import { wagmiConfig } from '@/config/wagmi';
import * as A from '@/contracts/artifacts';
import { useNetwork } from './Providers';
import type { toDeploymentsJson } from '@/lib/deployPlan';

type Check = { label: string; ok: boolean | undefined; note?: string };

/** Post-deploy checks: adapter wiring, Morpheus baseline, and cross-chain splitter prediction. */
export function HealthPanel({ deployments }: { deployments: ReturnType<typeof toDeploymentsJson> }) {
  const { net } = useNetwork();
  const [checks, setChecks] = useState<Check[]>([]);
  const [tick, setTick] = useState(0);
  const eth = deployments.ethereum as Record<string, Address | number>;
  const arb = deployments.arbitrum as Record<string, Address | number>;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const l1 = getPublicClient(wagmiConfig, { chainId: net.l1.id as never });
      const l2 = getPublicClient(wagmiConfig, { chainId: net.l2.id as never });
      const out: Check[] = [];
      const factory = eth.poolFactory as Address;
      try {
        const adapter = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'adapter' });
        out.push({ label: 'Factory uses the MorpheusAdapter', ok: adapter === eth.adapter });
        for (const s of net.stakeAssets) {
          const healthy = await l1.readContract({
            address: adapter,
            abi: A.MorpheusAdapter.abi,
            functionName: 'isHealthy',
            args: [s.depositPool],
          });
          const dp = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'depositPoolOf', args: [s.token] });
          out.push({ label: `${s.symbol}: Morpheus matches baseline`, ok: healthy });
          out.push({ label: `${s.symbol}: stake asset registered`, ok: dp === s.depositPool });
        }
        const probe = '0x000000000000000000000000000000000000dEaD' as Address;
        const predicted = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'predictSplitter', args: [probe, probe] });
        if (arb.splitterDeployer) {
          const salt = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'poolSalt', args: [probe] });
          const onArb = await l2.readContract({
            address: arb.splitterDeployer as Address,
            abi: A.SplitterDeployer.abi,
            functionName: 'predict',
            args: [salt, probe],
          });
          out.push({ label: 'Ethereum predicts the same splitter address as Arbitrum', ok: onArb === predicted });
        }
        const ref = await l1.readContract({ address: factory, abi: A.PoolFactory.abi, functionName: 'referralAddress' });
        out.push({ label: 'Referral address set', ok: ref !== zeroAddress, note: ref });
      } catch (e) {
        out.push({ label: 'Read failed', ok: false, note: e instanceof Error ? e.message.split('\n')[0] : String(e) });
      }
      if (!cancelled) setChecks(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [net, eth.poolFactory, eth.adapter, arb.splitterDeployer, tick]);

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-white">Health checks</h2>
        <button className="btn-ghost" onClick={() => setTick((t) => t + 1)}>
          Re-check
        </button>
      </div>
      <ul className="space-y-1 text-sm">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2">
            <span className={c.ok ? 'text-mor' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span>
            <span className="text-slate-300">{c.label}</span>
            {c.note && <span className="mono truncate text-slate-500">{c.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
