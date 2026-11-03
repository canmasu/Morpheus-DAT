'use client';

import { useEffect, useState } from 'react';
import { type Chain, zeroAddress } from 'viem';
import { useNetwork } from '@/components/Providers';
import { explorerAddress } from '@/config/networks';
import { STEPS, toDeploymentsJson, type DeployState } from '@/lib/deployPlan';
import { load } from '@/lib/storage';
import { useI18n } from '@/i18n/I18nProvider';
import testnet from '@/deployments/testnet.json';
import mainnet from '@/deployments/mainnet.json';

const COMMITTED: Record<string, Record<string, unknown>> = { testnet, mainnet };

export default function ContractsPage() {
  const { net } = useNetwork();
  const { t } = useI18n();
  const [local, setLocal] = useState<ReturnType<typeof toDeploymentsJson>>();
  useEffect(() => {
    const s = load<DeployState>(`dat-deploy-${net.name}`);
    setLocal(s ? toDeploymentsJson(s, net) : undefined);
  }, [net]);

  const committed = COMMITTED[net.name] as { ethereum?: Record<string, string>; arbitrum?: Record<string, string>; base?: Record<string, string> };
  const source = committed.ethereum ? committed : local;
  const fromLocal = !committed.ethereum && !!local;

  const datRows = (layer: 'l1' | 'l2' | 'base') => {
    const book = (layer === 'l1' ? source?.ethereum : layer === 'l2' ? source?.arbitrum : source?.base) as Record<string, string> | undefined;
    return STEPS.filter((s) => s.layer === layer && book?.[s.id] && !s.id.includes('_')).map((s) => [s.title, book![s.id]] as const);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">{t('nav.contracts')}</h1>
        <p className="text-sm text-slate-400">{net.label}</p>
        {fromLocal && <p className="mt-2 text-xs text-amber-300">{t('contracts.local')}</p>}
      </div>
      <Table title={`Morpheus DAT · ${net.l1.name}`} chain={net.l1} rows={datRows('l1')} empty={t('contracts.notDeployed')} />
      <Table title={`Morpheus DAT · ${net.l2.name}`} chain={net.l2} rows={datRows('l2')} empty={t('contracts.notDeployed')} />
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
      {net.builders && (
        <>
          <Table title={`Morpheus DAT · ${net.builders.chain.name}`} chain={net.builders.chain} rows={datRows('base')} empty={t('contracts.notDeployed')} />
          <Table
            title={net.builders.simulated ? t('contracts.simulated') : 'Morpheus Builders'}
            chain={net.builders.chain}
            rows={net.builders.contract === zeroAddress ? [] : [
              ['BuildersV4', net.builders.contract],
              ['MOR', net.builders.mor],
            ]}
            empty={t('contracts.notDeployed')}
          />
        </>
      )}
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
