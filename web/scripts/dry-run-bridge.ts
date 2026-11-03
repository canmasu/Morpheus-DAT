// The website's bridge steps on local forks of a home chain, Base and Ethereum, with LayerZero's live contracts. Delivery
// is simulated by calling lzReceive as the endpoint, since verifiers do not watch a fork.
//   anvil --fork-url https://sepolia.base.org --port 8547 &
//   anvil --fork-url https://bsc-testnet-rpc.publicnode.com --port 8548 &
//   anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8549 &
//   HOME_CHAIN=bsc-testnet npx tsx scripts/dry-run-bridge.ts
import { createPublicClient, createTestClient, createWalletClient, encodePacked, erc20Abi, formatUnits, http, pad, parseUnits, type Abi, type Address, type PublicClient, type TestClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as A from '../src/contracts/artifacts';
import { LZ_BASE, LZ_BASE_SEPOLIA, LZ_ETHEREUM, LZ_MAINNET_CHAINS, LZ_SEPOLIA, LZ_TESTNET_CHAINS } from '../src/config/lzChains';
import { viemChain } from '../src/config/bridge';
import { BRIDGE_STEPS, ulnAbi, type BridgeCtx, type BridgeResults, type Side } from '../src/lib/bridgePlan';
import { TERMS_HASH } from '../src/lib/bridgeTerms';

const me = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
// HOME_CHAIN is a key from lzChains.ts; use it with forks of that chain and of the matching Base.
const HOME = process.env.HOME_CHAIN ?? 'bsc-testnet';
const home = [...LZ_TESTNET_CHAINS, ...LZ_MAINNET_CHAINS].find((c) => c.key === HOME)!;
const base = LZ_TESTNET_CHAINS.includes(home) ? LZ_BASE_SEPOLIA : LZ_BASE;
const eth = LZ_TESTNET_CHAINS.includes(home) ? LZ_SEPOLIA : LZ_ETHEREUM;
const sides = ['home', 'base', 'eth'] as const;
const urls: Record<Side, string> = { base: 'http://127.0.0.1:8547', home: 'http://127.0.0.1:8548', eth: 'http://127.0.0.1:8549' };
const cfg: Record<Side, typeof home> = { home, base, eth };
const chains = Object.fromEntries(sides.map((x) => [x, viemChain(cfg[x])])) as Record<Side, ReturnType<typeof viemChain>>;
const pub = Object.fromEntries(sides.map((x) => [x, createPublicClient({ chain: chains[x], transport: http(urls[x]) })])) as Record<Side, PublicClient>;
const wal = Object.fromEntries(sides.map((x) => [x, createWalletClient({ account: me, chain: chains[x], transport: http(urls[x]) })])) as Record<Side, WalletClient>;
const test = Object.fromEntries(sides.map((x) => [x, createTestClient({ chain: chains[x], mode: 'anvil', transport: http(urls[x]) })])) as Record<Side, TestClient>;

const dep = async (side: Side, art: { abi: Abi; bytecode: `0x${string}` }, args: unknown[]) => {
  const hash = await wal[side].deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never);
  const r = await pub[side].waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('deploy reverted');
  return r.contractAddress!;
};
const send = async (side: Side, address: Address, abi: Abi, functionName: string, args: unknown[], value?: bigint) => {
  const { request } = await pub[side].simulateContract({ account: me, address, abi, functionName, args, value } as never);
  const hash = await wal[side].writeContract(request as never);
  const r = await pub[side].waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(functionName + ' reverted');
  return r;
};
const bal = (side: Side, t: Address, who: Address) => pub[side].readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
const supply = (side: Side, t: Address) => pub[side].readContract({ address: t, abi: erc20Abi, functionName: 'totalSupply' });
const nonces: Record<string, bigint> = {};

/** Sends `amount` from one side to another and delivers it the way LayerZero's endpoint would. */
async function move(oapps: Record<Side, Address | undefined>, from: Side, to: Side, amount: bigint) {
  const param = { dstEid: cfg[to].eid, to: pad(me.address), amountLD: amount, minAmountLD: amount, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' };
  const abi = A.OGTokenOFT.abi as Abi;
  const fee = (await pub[from].readContract({ address: oapps[from]!, abi, functionName: 'quoteSend', args: [param, false] } as never)) as { nativeFee: bigint; lzTokenFee: bigint };
  await send(from, oapps[from]!, abi, 'send', [param, fee, me.address], fee.nativeFee);
  const ep = cfg[to].endpoint;
  await test[to].impersonateAccount({ address: ep });
  await test[to].setBalance({ address: ep, value: parseUnits('1', 18) });
  const k = from + to;
  nonces[k] = (nonces[k] ?? 0n) + 1n;
  const hash = await createWalletClient({ chain: chains[to], transport: http(urls[to]) }).writeContract({
    account: ep,
    address: oapps[to]!,
    abi,
    functionName: 'lzReceive',
    args: [{ srcEid: cfg[from].eid, sender: pad(oapps[from]!), nonce: nonces[k] }, pad('0x01'), encodePacked(['bytes32', 'uint64'], [pad(me.address), amount / 10n ** 12n]), me.address, '0x'],
  } as never);
  if ((await pub[to].waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('lzReceive reverted');
  console.log(`moved ${formatUnits(amount, 18)} ${from} -> ${to}, fee ${formatUnits(fee.nativeFee, cfg[from].native.decimals)} ${cfg[from].native.symbol}`);
}

(async () => {
  const token = await dep('home', A.MockERC20 as never, ['Home Token', 'HOME', 18]);
  await send('home', token, A.MockERC20.abi as Abi, 'mint', [me.address, parseUnits('1000000', 18)]);
  const registry = await dep('base', A.OGBridgeRegistry as never, [base.endpoint]);
  const ethRegistry = home.eid === eth.eid ? undefined : await dep('eth', A.OGBridgeRegistry as never, [eth.endpoint]);

  const r: BridgeResults = { done: {} };
  // A contract stands in for each side's multisig: only its address matters here.
  const safe = async (side: Side) => dep(side, A.MockERC20 as never, ['Safe', 'S', 18]);
  const withEth = home.eid !== eth.eid;
  const p = { home, base, eth: withEth ? eth : undefined, registry, ethRegistry, token, name: 'Home Token', symbol: 'HOME', termsHash: TERMS_HASH, wallet: me.address, homeOwner: await safe('home'), baseOwner: await safe('base'), ethOwner: withEth ? await safe('eth') : undefined };
  const ctx: BridgeCtx = {
    p,
    r,
    deploy: (side, art, args) => dep(side, art, args),
    write: (side, a, abi, fn, args) => send(side, a, abi, fn, args),
    read: (side, a, abi, fn, args) => pub[side].readContract({ address: a, abi, functionName: fn, args } as never),
    simulate: (side, a, abi, fn, args) => pub[side].simulateContract({ account: me, address: a, abi, functionName: fn, args } as never),
  };
  let txCount = 0;
  const handover = (id: string) => id.endsWith('Delegate') || id.endsWith('Owner');
  for (const s of BRIDGE_STEPS.filter((x) => !handover(x.id) && !x.skip?.(p))) {
    await s.run(ctx);
    txCount++;
  }
  console.log('wiring steps ok', txCount);
  const oapps = { home: r.adapter, base: r.oft, eth: r.ethOft };
  for (const [side, remote] of (withEth ? [['home', 'base'], ['home', 'eth'], ['base', 'eth']] : [['home', 'base']]) as [Side, Side][]) {
    const c = (await ctx.read(side, cfg[side].sendLib, ulnAbi as Abi, 'getUlnConfig', [oapps[side], cfg[remote].eid])) as { requiredDVNCount: number };
    console.log(`verifiers ${side}->${remote}:`, c.requiredDVNCount);
  }

  // Partner funds both pool chains; a Farmer's claim on Ethereum then goes to Base and home.
  const amount = parseUnits('1000', 18);
  await send('home', token, erc20Abi as Abi, 'approve', [r.adapter!, amount * 2n]);
  await move(oapps, 'home', 'base', amount);
  await move(oapps, 'base', 'home', parseUnits('300', 18));
  if (withEth) {
    await move(oapps, 'home', 'eth', amount);
    await move(oapps, 'eth', 'base', parseUnits('100', 18));
    await move(oapps, 'eth', 'home', parseUnits('50', 18));
  }
  const locked = await bal('home', token, r.adapter!);
  const sb = await supply('base', r.oft!);
  const se = withEth ? await supply('eth', r.ethOft!) : 0n;
  console.log('locked', formatUnits(locked, 18), 'Base supply', formatUnits(sb, 18), 'Ethereum supply', formatUnits(se, 18));
  if (locked !== sb + se) throw new Error('locked tokens do not match the supply on Base and Ethereum');

  // Hand over, then the wallet must no longer be able to change the bridge.
  for (const s of BRIDGE_STEPS.filter((x) => handover(x.id) && !x.skip?.(p))) await s.run(ctx);
  let blocked = 0;
  const live = (withEth ? sides : ['home', 'base']) as Side[];
  for (const side of live) {
    try {
      await send(side, oapps[side]!, A.OGTokenOFT.abi as Abi, 'setPeer', [999, pad(me.address)]);
    } catch {
      blocked++;
    }
  }
  console.log('old wallet blocked on', blocked, 'of', live.length, 'chains');
  if (blocked !== live.length) throw new Error('hand-over failed');
  console.log('OK');
  process.exit(0);
})().catch((e) => {
  console.error(String(e).slice(0, 900));
  process.exit(1);
});
