'use client';

import { useEffect, useState } from 'react';
import type { Chain } from 'viem';
import { useNetwork } from '@/components/Providers';
import { explorerAddress } from '@/config/networks';
import { STEPS, toDeploymentsJson, type DeployState } from '@/lib/deployPlan';
import { load } from '@/lib/storage';
import testnet from '@/deployments/testnet.json';
import mainnet from '@/deployments/mainnet.json';

const COMMITTED: Record<string, Record<string, unknown>> = { testnet, mainnet };

export default function ContractsPage() {
  const { net } = useNetwork();
  const [local, setLocal] = useState<ReturnType<typeof toDeploymentsJson>>();
  useEffect(() => {
    const s = load<DeployState>(`dat-deploy-${net.name}`);
    setLocal(s ? toDeploymentsJson(s, net) : undefined);
  }, [net]);

  const committed = COMMITTED[net.name] as { ethereum?: Record<string, string>; arbitrum?: Record<string, string> };
  const source = committed.ethereum ? committed : local;
  const fromLocal = !committed.ethereum && !!local;

  const datRows = (layer: 'l1' | 'l2') => {
    const book = (layer === 'l1' ? source?.ethereum : source?.arbitrum) as Record<string, string> | undefined;
    return STEPS.filter((s) => s.layer === layer && book?.[s.id] && !s.id.includes('_')).map((s) => [s.title, book![s.id]] as const);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Contracts</h1>
        <p className="text-sm text-slate-400">{net.label}</p>
        {fromLocal && <p className="mt-2 text-xs text-amber-300">Showing this browser&apos;s deploy progress; not yet committed.</p>}
      </div>
      <Table title={`Morpheus DAT · ${net.l1.name}`} chain={net.l1} rows={datRows('l1')} empty="Not deployed yet." />
      <Table title={`Morpheus DAT · ${net.l2.name}`} chain={net.l2} rows={datRows('l2')} empty="Not deployed yet." />
      <Table
        title="Morpheus Capital"
        chain={net.l1}
        rows={[
          ['Distributor', net.morpheus.distributor],
          ['L1Sender', net.morpheus.l1Sender],
          ...net.stakeAssets.flatMap((a) => [
            [`${a.symbol} DepositPool`, a.depositPool] as const,
            [`${a.symbol} token`, a.token] as const,
          ]),
        ]}
      />
      <Table title={`MOR · ${net.l2.name}`} chain={net.l2} rows={[['MOR', net.mor]]} />
    </div>
  );
}

function Table({ title, chain, rows, empty }: { title: string; chain: Chain; rows: readonly (readonly [string, string])[]; empty?: string }) {
  return (
    <section className="card">
      <h2 className="mb-3 font-medium text-white">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-ink-line">
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-2 pr-4 text-slate-400">{k}</td>
                <td className="py-2 text-right">
                  <a className="mono break-all text-mor hover:underline" href={explorerAddress(chain, v)} target="_blank" rel="noreferrer">
                    {v}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
