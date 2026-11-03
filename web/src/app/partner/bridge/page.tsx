'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { type Abi, type Address, type Hash, erc20Abi, formatUnits, isAddress, parseUnits } from 'viem';
import * as A from '@/contracts/artifacts';
import { useNetwork } from '@/components/Providers';
import { ConnectButton } from '@/components/ConnectButton';
import { AddToWallet } from '@/components/AddToWallet';
import { lzBaseOf, lzChainsOf, lzEthereumOf, pathVerifiers, viemChain } from '@/config/bridge';
import { explorerAddress } from '@/config/networks';
import { BRIDGE_STEPS, type BridgeCtx, type BridgeParams, type BridgeResults, type Side } from '@/lib/bridgePlan';
import { TERMS_APPROVED, TERMS_HASH, TERMS_TEXT } from '@/lib/bridgeTerms';
import { ethRegistryOf, registryOf, sendParam, withoutDust } from '@/lib/bridge';
import { deploy, ensureAllowance, errorText, publicClient, write } from '@/lib/tx';
import { load, remove, save } from '@/lib/storage';
import { short } from '@/lib/format';

type Saved = {
  homeKey: string;
  token: string;
  homeOwner: string;
  baseOwner: string;
  ethOwner: string;
  /** Also deploy on Ethereum, to fund stETH and stablecoin pools. */
  withEth: boolean;
  accepted: boolean;
  wallet?: Address;
  name?: string;
  symbol?: string;
  decimals?: number;
  results: BridgeResults;
};

type TokenInfo = { name: string; symbol: string; decimals: number; balance: bigint };

const friendly = (e: unknown) => {
  const text = errorText(e);
  if (text.includes('TransferTaxNotSupported')) {
    return 'This token takes a fee on transfer, so it cannot be bridged safely: the bridge would mint more on Base than it locked. Use a version of the token with no tax.';
  }
  return text;
};

export default function BridgePage() {
  const { address, isConnected } = useAccount();
  const { net } = useNetwork();
  const chains = lzChainsOf(net);
  const base = lzBaseOf(net);
  const baseChain = useMemo(() => viemChain(base), [base]);
  const registry = registryOf(net);
  const ethRegistry = ethRegistryOf(net);
  const ethereum = lzEthereumOf(net);
  const ethChain = useMemo(() => viemChain(ethereum), [ethereum]);
  const isMainnet = net.name === 'mainnet';
  const key = `dat-bridge-${net.name}`;
  const blank = useCallback((): Saved => ({ homeKey: chains[0].key, token: '', homeOwner: '', baseOwner: '', ethOwner: '', withEth: true, accepted: false, results: { done: {} } }), [chains]);

  const [mounted, setMounted] = useState(false);
  const [s, setS] = useState<Saved>(blank);
  const [token, setToken] = useState<TokenInfo>();
  const [tokenError, setTokenError] = useState<string>();
  const [ownerError, setOwnerError] = useState<string>();
  const [riskAck, setRiskAck] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState<bigint>();
  const [sent, setSent] = useState<Hash>();
  const [baseBalance, setBaseBalance] = useState<bigint>();
  const [dest, setDest] = useState<'base' | 'eth'>('base');

  useEffect(() => {
    setMounted(true);
    setS(load<Saved>(key) ?? blank());
  }, [key, blank]);

  const update = (next: Saved) => {
    setS(next);
    save(key, next);
  };

  const home = chains.find((c) => c.key === s.homeKey) ?? chains[0];
  const homeChain = useMemo(() => viemChain(home), [home]);
  const started = !!s.results.adapter;
  const chainOf = useCallback((side: Side) => (side === 'home' ? homeChain : side === 'base' ? baseChain : ethChain), [homeChain, baseChain, ethChain]);
  // A token already on Ethereum funds Ethereum pools directly.
  const homeIsEthereum = home.eid === ethereum.eid;
  const useEth = s.withEth && !homeIsEthereum;

  // Token facts, from the home chain.
  useEffect(() => {
    setToken(undefined);
    setTokenError(undefined);
    if (!isAddress(s.token)) return;
    const t = { address: s.token as Address, abi: erc20Abi } as const;
    const c = publicClient(homeChain);
    Promise.all([
      c.readContract({ ...t, functionName: 'name' }),
      c.readContract({ ...t, functionName: 'symbol' }),
      c.readContract({ ...t, functionName: 'decimals' }),
      address ? c.readContract({ ...t, functionName: 'balanceOf', args: [address] }) : 0n,
    ]).then(
      ([name, symbol, decimals, balance]) => {
        setToken({ name, symbol, decimals, balance });
        if (decimals < 6) setTokenError('Tokens with fewer than 6 decimals cannot use this bridge.');
      },
      () => setTokenError(`No ERC-20 token at this address on ${home.name}.`),
    );
  }, [s.token, homeChain, home.name, address, sent]);

  // On mainnet the bridge must end up owned by a contract (a multisig) on both chains.
  const homeOwner = (s.homeOwner || address || '') as Address;
  const baseOwner = (s.baseOwner || address || '') as Address;
  const ethOwner = (s.ethOwner || address || '') as Address;
  useEffect(() => {
    setOwnerError(undefined);
    if (!isMainnet) return;
    const check = async () => {
      if (!isAddress(homeOwner) || !isAddress(baseOwner)) return setOwnerError('Enter your multisig on both chains.');
      const [a, b] = await Promise.all([publicClient(homeChain).getCode({ address: homeOwner }), publicClient(baseChain).getCode({ address: baseOwner })]);
      if (!a || a === '0x') return setOwnerError(`${short(homeOwner)} is not a contract on ${home.name}. Use a multisig such as a Safe.`);
      if (!b || b === '0x') return setOwnerError(`${short(baseOwner)} is not a contract on ${base.name}. Use a multisig such as a Safe.`);
      if (useEth) {
        if (!isAddress(ethOwner)) return setOwnerError('Enter your multisig on Ethereum.');
        const c = await publicClient(ethChain).getCode({ address: ethOwner });
        if (!c || c === '0x') return setOwnerError(`${short(ethOwner)} is not a contract on ${ethereum.name}. Use a multisig such as a Safe.`);
      }
    };
    check().catch(() => setOwnerError('Could not check the multisig addresses. Try again.'));
  }, [isMainnet, homeOwner, baseOwner, ethOwner, useEth, homeChain, baseChain, ethChain, home.name, base.name, ethereum.name]);

  const params = (): BridgeParams => ({
    home,
    base,
    eth: useEth ? ethereum : undefined,
    registry: registry!,
    ethRegistry,
    token: s.token as Address,
    name: s.name ?? token!.name,
    symbol: s.symbol ?? token!.symbol,
    termsHash: TERMS_HASH,
    wallet: (s.wallet ?? address) as Address,
    homeOwner,
    baseOwner,
    ethOwner,
  });

  const blockReason = !isConnected
    ? 'Connect your wallet.'
    : isMainnet && !TERMS_APPROVED
      ? 'Mainnet opens once the terms have been approved by a lawyer.'
      : !registry
        ? `The bridge registry is not deployed on ${base.name} yet: run its step on the admin deploy page.`
        : useEth && !ethRegistry
          ? `The bridge registry is not deployed on ${ethereum.name} yet: run its step on the admin deploy page.`
        : s.wallet && address && s.wallet.toLowerCase() !== address.toLowerCase()
          ? `Connect ${short(s.wallet)}, the wallet that started this bridge.`
          : !started && (!token || tokenError)
            ? (tokenError ?? 'Enter your token.')
            : !started && token!.balance < 10n ** BigInt(Math.max(token!.decimals - 6, 0))
              ? `This wallet needs a little ${token!.symbol} on ${home.name} for the token check.`
              : ownerError ?? (!s.accepted || (!started && !riskAck) ? 'Read and accept the terms first.' : undefined);

  const lite = { eth: useEth ? ethereum : undefined, wallet: s.wallet ?? address ?? '', homeOwner, baseOwner, ethOwner } as BridgeParams;
  const notNeeded = (st: (typeof BRIDGE_STEPS)[number]) => !!st.skip?.(lite);
  const finished = mounted && BRIDGE_STEPS.every((x) => s.results.done[x.id] || notNeeded(x));

  const run = async (all: boolean) => {
    setError(undefined);
    let cur: Saved = { ...s, wallet: s.wallet ?? address, name: s.name ?? token?.name, symbol: s.symbol ?? token?.symbol, decimals: s.decimals ?? token?.decimals };
    try {
      for (const step of BRIDGE_STEPS) {
        if (cur.results.done[step.id]) continue;
        const p = params();
        if (step.skip?.(p)) {
          cur = { ...cur, results: { ...cur.results, done: { ...cur.results.done, [step.id]: true } } };
          update(cur);
          continue;
        }
        setBusy(step.id);
        const results: BridgeResults = { ...cur.results };
        const ctx: BridgeCtx = {
          p,
          r: results,
          deploy: async (side, art, args, label) => (await deploy(chainOf(side), p.wallet, art, args, label)).address,
          write: async (side, a, abi, fn, args) => (await write(chainOf(side), p.wallet, a, abi, fn, args)).receipt,
          read: (side, a, abi, fn, args) => publicClient(chainOf(side)).readContract({ address: a, abi, functionName: fn, args }),
          simulate: (side, a, abi, fn, args) => publicClient(chainOf(side)).simulateContract({ account: p.wallet, address: a, abi, functionName: fn, args }),
        };
        await step.run(ctx);
        cur = { ...cur, results: { ...results, done: { ...results.done, [step.id]: true } } };
        update(cur);
        if (!all) break;
      }
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(undefined);
    }
  };

  const makeTestToken = async () => {
    if (!address) return;
    setBusy('testToken');
    setError(undefined);
    try {
      const { address: t } = await deploy(homeChain, address, A.MockERC20 as never, ['Test OG Token', 'tOG', 18], 'Deploy test token');
      await write(homeChain, address, t, A.MockERC20.abi as Abi, 'mint', [address, parseUnits('42000000', 18)]);
      update({ ...s, token: t });
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(undefined);
    }
  };

  // Sending the budget to Base.
  const decimals = s.decimals ?? token?.decimals ?? 18;
  const parsed = useMemo(() => {
    try {
      return withoutDust(parseUnits(amount.replace(/,/g, '') || '0', decimals), decimals);
    } catch {
      return 0n;
    }
  }, [amount, decimals]);
  const adapter = s.results.adapter;
  const oft = s.results.oft;
  const ethOft = s.results.ethOft;
  const destChain = dest === 'eth' && ethOft ? ethereum : base;
  const destToken = dest === 'eth' && ethOft ? ethOft : oft;
  const destViem = dest === 'eth' && ethOft ? ethChain : baseChain;

  useEffect(() => {
    setFee(undefined);
    if (!finished || !adapter || parsed === 0n || !address) return;
    publicClient(homeChain)
      .readContract({ address: adapter, abi: A.OGTokenAdapter.abi, functionName: 'quoteSend', args: [sendParam(destChain.eid, address, parsed), false] })
      .then((f) => setFee(f.nativeFee), () => setFee(undefined));
  }, [finished, adapter, parsed, address, homeChain, destChain.eid]);

  const refreshBase = useCallback(() => {
    if (!destToken || !address) return;
    publicClient(destViem).readContract({ address: destToken, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).then(setBaseBalance, () => {});
  }, [destToken, address, destViem]);
  useEffect(() => {
    refreshBase();
    if (!sent) return;
    const timer = setInterval(refreshBase, 10_000);
    return () => clearInterval(timer);
  }, [refreshBase, sent]);

  const bridge = async () => {
    if (!address || !adapter) return;
    setBusy('bridge');
    setError(undefined);
    try {
      await ensureAllowance(homeChain, address, s.token as Address, adapter, parsed);
      const param = sendParam(destChain.eid, address, parsed);
      const f = await publicClient(homeChain).readContract({ address: adapter, abi: A.OGTokenAdapter.abi, functionName: 'quoteSend', args: [param, false] });
      const { hash } = await write(homeChain, address, adapter, A.OGTokenAdapter.abi as Abi, 'send', [param, f, address], f.nativeFee);
      setSent(hash);
      setAmount('');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(undefined);
    }
  };

  const reset = () => {
    if (!confirmReset) return setConfirmReset(true);
    remove(key);
    setS(blank());
    setConfirmReset(false);
    setSent(undefined);
    setRiskAck(false);
  };

  if (!mounted) return null;

  const scan = net.name === 'mainnet' ? 'https://layerzeroscan.com/tx/' : 'https://testnet.layerzeroscan.com/tx/';
  const symbol = s.symbol ?? token?.symbol ?? 'token';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/partner/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Partners
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Bring your token from another chain</h1>
        <p className="mt-1 text-sm text-slate-400">
          Set up your own LayerZero bridge, then fund pools with your token: {base.name} for MOR pools, {ethereum.name} for stETH and stablecoin pools. Farmers can
          bridge what they earn back to your chain. You deploy and own every contract: Morpheus DAT never holds your tokens or controls your bridge.
        </p>
      </div>

      {!isConnected && (
        <div className="card flex items-center justify-between">
          <span className="text-sm text-slate-400">Connect the wallet that holds your token.</span>
          <ConnectButton />
        </div>
      )}

      {/* 1 · token */}
      <section className="card space-y-3">
        <h2 className="font-medium text-white">1 · Your token</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Chain it lives on</label>
            <select className="input" disabled={started} value={s.homeKey} onChange={(e) => update({ ...s, homeKey: e.target.value })}>
              {chains.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Token address</label>
            <input className="input" disabled={started} placeholder="0x…" value={s.token} onChange={(e) => update({ ...s, token: e.target.value.trim() })} />
          </div>
        </div>
        {token && !tokenError && (
          <p className="text-xs text-slate-400">
            {token.name} ({token.symbol}) · your balance {Number(formatUnits(token.balance, token.decimals)).toLocaleString()} {token.symbol}
          </p>
        )}
        {tokenError && <p className="text-xs text-red-400">{tokenError}</p>}
        {!isMainnet && !started && (
          <button className="text-xs text-mor hover:underline disabled:opacity-40" disabled={!isConnected || !!busy} onClick={makeTestToken}>
            {busy === 'testToken' ? 'Confirm in your wallet…' : `Testnet: create a test token on ${home.name}`}
          </button>
        )}
        {pathVerifiers(home, base).length < 2 && (
          <p className="text-xs text-amber-300">Testnet only: LayerZero has one shared verifier for this chain and {base.name}. Mainnet always requires two.</p>
        )}
        {homeIsEthereum ? (
          <p className="text-xs text-slate-400">Your token is already on {ethereum.name}, so it can fund stETH and stablecoin pools without a bridge. This sets it up for {base.name} too.</p>
        ) : (
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" className="mt-1" disabled={started} checked={s.withEth} onChange={(e) => update({ ...s, withEth: e.target.checked })} />
            <span>
              Also put it on {ethereum.name}, to fund stETH and stablecoin pools. Without this you can only fund MOR pools on {base.name}, and you cannot add it later from this page. It adds
              8 to 10 confirmations, some at {ethereum.name} gas prices.
            </span>
          </label>
        )}
        <p className="text-xs text-slate-500">
          Verifiers: {pathVerifiers(home, base).join(' + ')}. You need {home.native.symbol} on {home.name} and ETH on {base.name}
          {useEth ? ` and ${ethereum.name}` : ''} for gas.
        </p>
      </section>

      {/* 2 · owners */}
      <section className="card space-y-3">
        <h2 className="font-medium text-white">2 · Who owns the bridge</h2>
        <p className="text-sm text-slate-400">
          The owner can change this bridge&apos;s settings, so a stolen key could drain the tokens it locks.{' '}
          {isMainnet ? 'A multisig on both chains is required.' : 'On testnet your wallet is fine. On mainnet a multisig is required.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Owner on {home.name}</label>
            <input className="input" disabled={started} placeholder={isMainnet ? 'Your multisig' : address ?? '0x…'} value={s.homeOwner} onChange={(e) => update({ ...s, homeOwner: e.target.value.trim() })} />
          </div>
          <div>
            <label className="label">Owner on {base.name}</label>
            <input className="input" disabled={started} placeholder={isMainnet ? 'Your multisig' : address ?? '0x…'} value={s.baseOwner} onChange={(e) => update({ ...s, baseOwner: e.target.value.trim() })} />
          </div>
          {useEth && (
            <div>
              <label className="label">Owner on {ethereum.name}</label>
              <input className="input" disabled={started} placeholder={isMainnet ? 'Your multisig' : address ?? '0x…'} value={s.ethOwner} onChange={(e) => update({ ...s, ethOwner: e.target.value.trim() })} />
            </div>
          )}
        </div>
        {ownerError && <p className="text-xs text-red-400">{ownerError}</p>}
      </section>

      {/* 3 · terms */}
      <section className="card space-y-3">
        <h2 className="font-medium text-white">3 · Terms</h2>
        {!TERMS_APPROVED && <p className="text-xs text-amber-300">Draft for testing. A lawyer must review these before mainnet.</p>}
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 font-sans text-xs text-slate-300">{TERMS_TEXT}</pre>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" disabled={started} checked={s.accepted} onChange={(e) => update({ ...s, accepted: e.target.checked })} />
          <span>I have read and agree to these terms, for myself and for the project I represent.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" disabled={started} checked={started || riskAck} onChange={(e) => setRiskAck(e.target.checked)} />
          <span>I understand I own this bridge and its risks, and that Morpheus DAT cannot recover lost tokens or undo anything I do.</span>
        </label>
        <p className="text-xs text-slate-500">
          Your acceptance is recorded on {base.name} when your token is deployed there, as this hash: <span className="mono break-all">{TERMS_HASH}</span>
        </p>
      </section>

      {/* 4 · steps */}
      <section className="card space-y-3">
        <h2 className="font-medium text-white">4 · Set up the bridge</h2>
        <p className="text-sm text-slate-400">Each step asks for a wallet confirmation, and your wallet switches chain as needed. You can stop and continue later in this browser.</p>
        <ol className="divide-y divide-ink-line rounded-lg border border-ink-line">
          {BRIDGE_STEPS.filter((st) => !notNeeded(st)).map((st) => {
            const done = s.results.done[st.id];
            return (
              <li key={st.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-mor/15 text-mor' : busy === st.id ? 'bg-amber-500/15 text-amber-300' : 'bg-white/5 text-slate-500'}`}>
                  {done ? '✓' : busy === st.id ? '…' : ''}
                </span>
                <div>
                  <div className="text-sm text-white">
                    {st.title}
                  </div>
                  <div className="text-xs text-slate-500">
                    {chainOf(st.side).name} · {st.detail}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {blockReason && !finished && !busy && <p className="text-sm text-amber-300">{blockReason}</p>}
        {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!finished && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!blockReason || !!busy} onClick={() => run(true)}>
              {busy ? 'Confirm in your wallet…' : started ? 'Continue' : 'Start setup'}
            </button>
            <button className="btn-ghost" disabled={!!blockReason || !!busy} onClick={() => run(false)}>
              Next step only
            </button>
          </div>
        )}
        {(adapter || oft || ethOft) && (
          <dl className="space-y-1 text-xs text-slate-400">
            {adapter && (
              <div>
                Adapter on {home.name}:{' '}
                <a className="mono hover:underline" href={explorerAddress(homeChain, adapter)} target="_blank" rel="noreferrer">
                  {adapter} ↗
                </a>
              </div>
            )}
            {oft && (
              <div>
                {symbol} on {base.name}:{' '}
                <a className="mono hover:underline" href={explorerAddress(baseChain, oft)} target="_blank" rel="noreferrer">
                  {oft} ↗
                </a>
              </div>
            )}
            {ethOft && (
              <div>
                {symbol} on {ethereum.name}:{' '}
                <a className="mono hover:underline" href={explorerAddress(ethChain, ethOft)} target="_blank" rel="noreferrer">
                  {ethOft} ↗
                </a>
              </div>
            )}
          </dl>
        )}
        {started && (
          <button className="text-xs text-slate-500 hover:text-red-300" onClick={reset}>
            {confirmReset ? 'Forget this bridge in this browser? Contracts stay on-chain. Click again to confirm.' : 'Start a different bridge'}
          </button>
        )}
      </section>

      {/* 5 · bridge */}
      {finished && oft && (
        <section className="card space-y-3">
          <h2 className="font-medium text-white">5 · Send your pool budget</h2>
          <p className="text-sm text-slate-400">
            Only bridge what the pool needs: tokens locked in your adapter are what a compromised bridge could lose. Try a small amount first.
          </p>
          {ethOft && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['base', `${base.name}: for MOR pools`],
                  ['eth', `${ethereum.name}: for stETH and stablecoin pools`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setDest(value);
                    setBaseBalance(undefined);
                  }}
                  className={`rounded-xl border p-3 text-left text-sm ${dest === value ? 'border-mor bg-mor/10 text-white' : 'border-ink-line text-slate-300 hover:border-slate-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-48" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="text-sm text-slate-300">{symbol}</span>
            <button className="btn-primary" disabled={parsed === 0n || !!busy || !isConnected} onClick={bridge}>
              {busy === 'bridge' ? 'Confirm in your wallet…' : `Send to ${destChain.name}`}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {token && `On ${home.name}: ${Number(formatUnits(token.balance, token.decimals)).toLocaleString()} ${symbol}. `}
            {fee !== undefined && `LayerZero fee ≈ ${Number(formatUnits(fee, home.native.decimals)).toFixed(6)} ${home.native.symbol}.`}
          </p>
          {sent && (
            <p className="text-xs text-mor">
              Sent. It usually arrives within minutes.{' '}
              <a className="underline" href={`${scan}${sent}`} target="_blank" rel="noreferrer">
                Track it on LayerZero Scan ↗
              </a>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <span>
              Your {symbol} on {destChain.name}: {baseBalance !== undefined ? Number(formatUnits(baseBalance, 18)).toLocaleString() : '…'}
            </span>
            <AddToWallet chain={destViem} token={destToken!} symbol={symbol} decimals={18} />
          </div>
          <Link className={baseBalance ? 'btn-primary' : 'btn-ghost pointer-events-none opacity-40'} href={dest === 'eth' && ethOft ? `/partner/create/?token=${ethOft}` : `/partner/create/?c=base&token=${oft}`}>
            {dest === 'eth' && ethOft ? 'Create a stETH or stablecoin pool with this token →' : 'Create a MOR pool with this token →'}
          </Link>
        </section>
      )}
    </div>
  );
}
