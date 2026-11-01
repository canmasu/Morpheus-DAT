'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { parseUnits } from 'viem';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { useChainNow } from '@/hooks/useChainNow';
import { anvil, isLocalHost, sandboxUrls } from '@/lib/sandbox';
import { errorText } from '@/lib/tx';

export default function SandboxPage() {
  const { net, setNetwork } = useNetwork();
  const { address, isConnected } = useAccount();
  const now = useChainNow(net);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (!isLocalHost()) return <p className="card text-sm text-slate-400">The sandbox only runs on your own computer (localhost).</p>;
  if (net.name !== 'local') {
    return (
      <div className="card space-y-3">
        <h1 className="text-lg font-medium text-white">Local sandbox</h1>
        <p className="text-sm text-slate-400">
          A copy of Ethereum mainnet with the real Morpheus USDC and USDT pools, running on this computer. Start it with{' '}
          <span className="mono">npm run sandbox</span> in the <span className="mono">web</span> folder.
        </p>
        <button className="btn-primary" onClick={() => setNetwork('local')}>
          Switch the site to the sandbox
        </button>
      </div>
    );
  }

  const [l1Url, l2Url] = sandboxUrls(net);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(undefined);
    setMsg(undefined);
    try {
      setMsg(await fn());
    } catch (e) {
      setError(`${errorText(e)}. Is \`npm run sandbox\` running?`);
    } finally {
      setBusy(undefined);
    }
  };

  const faucet = (symbol: string, amount: string) =>
    run(`faucet-${symbol}`, async () => {
      const asset = net.stakeAssets.find((a) => a.symbol === symbol)!;
      const units = parseUnits(amount, asset.decimals);
      const current = BigInt(
        await anvil(l1Url, 'eth_call', [{ to: asset.token, data: `0x70a08231${address!.slice(2).padStart(64, '0')}` }, 'latest']),
      );
      await anvil(l1Url, 'anvil_dealERC20', [address, asset.token, `0x${(current + units).toString(16)}`]);
      return `Added ${amount} ${symbol} to your wallet.`;
    });

  const eth = () =>
    run('eth', async () => {
      for (const url of [l1Url, l2Url]) await anvil(url, 'anvil_setBalance', [address, '0x56BC75E2D63100000']);
      return 'Your wallet has 100 ETH on both sandbox chains.';
    });

  const skip = (seconds: number, label: string) =>
    run(`skip-${seconds}`, async () => {
      for (const url of [l1Url, l2Url]) {
        await anvil(url, 'evm_increaseTime', [seconds]);
        await anvil(url, 'evm_mine', []);
      }
      return `Skipped ${label}. Pages follow the chain clock within 15 seconds.`;
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Local sandbox</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Real Morpheus Capital (USDC, USDT, stETH pools) on a copy of Ethereum mainnet, plus a local chain standing in for Arbitrum.
          Restarting <span className="mono">npm run sandbox</span> resets everything, including deployed contracts.
        </p>
        <p className="mt-2 text-sm text-slate-300">Chain time: {new Date(now * 1000).toLocaleString()}</p>
      </div>

      {!isConnected ? (
        <div className="card flex items-center justify-between">
          <span className="text-sm text-slate-400">Connect your wallet to use the faucet.</span>
          <ConnectButton />
        </div>
      ) : (
        <>
          <section className="card space-y-3">
            <h2 className="font-medium text-white">Faucet</h2>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!!busy} onClick={() => faucet('USDT', '10000')}>
                + 10,000 USDT
              </button>
              <button className="btn-primary" disabled={!!busy} onClick={() => faucet('USDC', '10000')}>
                + 10,000 USDC
              </button>
              <button className="btn-ghost" disabled={!!busy} onClick={eth}>
                100 ETH on both chains
              </button>
            </div>
          </section>
          <section className="card space-y-3">
            <h2 className="font-medium text-white">Time</h2>
            <p className="text-xs text-slate-500">
              Skips both sandbox chains forward. Use it to reach deposit start, MOR claim windows (14 days), pre-fetch (30 days before
              unlock) and unlock.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                [3600, '1 hour'],
                [86400, '1 day'],
                [15 * 86400, '15 days'],
                [30 * 86400, '30 days'],
                [365 * 86400, '1 year'],
              ].map(([s, l]) => (
                <button key={s} className="btn-ghost" disabled={!!busy} onClick={() => skip(s as number, l as string)}>
                  + {l}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {msg && <p className="text-sm text-mor">{msg}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <section className="card space-y-2 text-sm text-slate-400">
        <h2 className="font-medium text-white">Testing USDT end to end</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Admin → Deploy, select Local sandbox, Run all remaining.</li>
          <li>Partners → Create a pool: create tEXM, enable USDT, keep a 12-month lock, create.</li>
          <li>Here: + 10,000 USDT, then + 1 hour so deposits are open.</li>
          <li>Pools → your pool → stake USDT.</li>
          <li>Here: + 1 year. Dashboard → Withdraw stake + reward.</li>
        </ol>
      </section>
    </div>
  );
}
