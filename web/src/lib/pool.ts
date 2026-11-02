import { type Address, formatUnits, isAddress, parseUnits } from 'viem';
import type { NetworkConfig, StakeAsset } from '@/config/networks';

export const YEAR = 365n * 86400n;
/** Internal rate unit: rates are stored per this many stake tokens. */
export const RATE_UNIT_TOKENS = '1000000';
export const PREFETCH_WINDOW_DAYS = 30;

export type LockRow = { months: string; mult: string };
export type SleeveForm = {
  enabled: boolean;
  /** Reward tokens one stake token earns per year at 1x, e.g. '0.001'. */
  perToken: string;
  cap: string;
  minPerWallet: string;
  maxPerWallet: string;
  /** Alpha: amount brackets (starts, ascending), one multiplier per bracket, one lock, max per stake. */
  fixedEnabled: boolean;
  fixedAmounts: string;
  fixedMult: string;
  fixedLock: number;
  fixedMax: string;
};
export type PoolForm = {
  rewardToken: string;
  locks: LockRow[];
  sleeves: Record<string, SleeveForm>;
  start: string;
  end: string;
  epochDays: string;
  morBoost: boolean;
  budget: string;
};

/** Mirrors IPoolTypes.PoolConfig. */
export type PoolConfig = {
  rewardToken: Address;
  sleeves: {
    stakeToken: Address;
    unit: bigint;
    ratePerUnit: bigint;
    cap: bigint;
    tiers: { kind: number; minPerWallet: bigint; maxPerWallet: bigint; amounts: bigint[]; multBps: number[]; lockOptionId: number }[];
  }[];
  lockOptions: { duration: bigint; multBps: number }[];
  depositStart: bigint;
  depositEnd: bigint;
  epochLength: bigint;
  morBoost: boolean;
};

/** Base rates are at 1x: multipliers are entered exactly as contributors see them (Alpha $100 = 1x, Omega 12
 * months = 20x). 1,000 per $1M at 1x = the proposal's 20,000 per $1M at Omega 12 months. */
const SLEEVE_DEFAULTS: Record<string, Partial<SleeveForm>> = {
  USDC: { perToken: '0.001', cap: '10000000', minPerWallet: '1000000', maxPerWallet: '10000000' },
  USDT: { perToken: '0.001', cap: '10000000', minPerWallet: '1000000', maxPerWallet: '10000000' },
  stETH: { perToken: '1', cap: '10000', minPerWallet: '1000', maxPerWallet: '10000' },
  stETHMock: { perToken: '1', cap: '10000', minPerWallet: '1000', maxPerWallet: '10000' },
  LINK: { perToken: '0.001', cap: '10000000', minPerWallet: '1000000', maxPerWallet: '10000000' },
};

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function defaultForm(net: NetworkConfig, nowMs = Date.now()): PoolForm {
  const now = nowMs;
  return {
    rewardToken: '',
    locks: [
      { months: '12', mult: '20' },
      { months: '24', mult: '22' },
      { months: '36', mult: '25' },
      { months: '48', mult: '30' },
      { months: '60', mult: '50' },
    ],
    sleeves: Object.fromEntries(
      net.stakeAssets.map((a, i) => [
        a.symbol,
        {
          enabled: i === 0,
          perToken: '0.001',
          cap: '1000000',
          minPerWallet: '1',
          maxPerWallet: '',
          fixedEnabled: false,
          fixedAmounts: '100, 1000, 10000, 100000',
          fixedMult: '1, 2, 3, 5',
          fixedLock: 0,
          fixedMax: '',
          ...SLEEVE_DEFAULTS[a.symbol],
        } satisfies SleeveForm,
      ]),
    ),
    start: toLocalInput(new Date(now + 15 * 60_000)),
    end: toLocalInput(new Date(now + 180 * 86400_000)),
    epochDays: '30',
    // Off by default: boost locks MOR until unlock (12 – 60 months) and cannot be undone.
    morBoost: false,
    budget: '',
  };
}

/** How many USD one token counts as when copying the USD tier table to another asset. Derived from the
 * proposal's rates (20,000 per $1M vs 10,000 per 500 stETH → 1 stETH = $1,000); no price feed. On testnet LINK
 * stands in for USDC, so it is 1:1. */
const USD_PER_TOKEN: Record<string, number> = { USDC: 1, USDT: 1, LINK: 1, stETH: 1000, stETHMock: 1000 };

/** The example pool from the proposal, applied to every stake asset on the network, with the base rate at 1x:
 * Alpha (from $100: brackets $100 / $1k / $10k / $100k at 1x / 2x / 3x / 5x, 12 months, up to just under $1M)
 * and Omega ($1M – $10M per wallet, 20x / 22x / 25x / 30x / 50x by lock). Non-USD assets are scaled by
 * USD_PER_TOKEN. */
export function applyExamplePool(form: PoolForm, net: NetworkConfig): PoolForm {
  const sleeves = { ...form.sleeves };
  for (const a of net.stakeAssets) {
    const f = USD_PER_TOKEN[a.symbol];
    if (!f || !sleeves[a.symbol]) continue;
    const t = (usd: number) => String(usd / f);
    const justBelow = (usd: number) => formatUnits(parseUnits(t(usd), a.decimals) - 1n, a.decimals);
    sleeves[a.symbol] = {
      ...sleeves[a.symbol],
      enabled: true,
      // At 1x, $1 earns 0.001 per year (= 1,000 per $1M); 1 stETH (= $1,000) earns 1
      perToken: String(0.001 * f),
      cap: t(100_000_000),
      minPerWallet: t(1_000_000),
      maxPerWallet: t(10_000_000),
      fixedEnabled: true,
      fixedAmounts: [100, 1_000, 10_000, 100_000].map(t).join(', '),
      fixedMult: '1, 2, 3, 5',
      fixedLock: 0,
      fixedMax: justBelow(1_000_000),
    };
  }
  return {
    ...form,
    epochDays: '30',
    morBoost: false,
    locks: [
      { months: '12', mult: '20' },
      { months: '24', mult: '22' },
      { months: '36', mult: '25' },
      { months: '48', mult: '30' },
      { months: '60', mult: '50' },
    ],
    sleeves,
  };
}

/** New pools store multipliers exactly as shown (base rate at 1x), so this is 1x. Older pools that used
 * fractions below 1x (e.g. Alpha 0.05x) are shown relative to their lowest multiplier instead. */
export function baseMultBps(locks: { multBps: number }[], tiers: { kind: number; multBps: readonly number[] }[]) {
  const all = [...locks.map((l) => l.multBps), ...tiers.filter((t) => t.kind !== 0).flatMap((t) => [...t.multBps])];
  return Math.max(1, Math.min(10_000, ...all));
}

export const fmtMult = (bps: number, base: number) => {
  const x = bps / base;
  return `${Number.isInteger(x) ? x : +x.toFixed(2)}x`;
};

/** 12 months = 365 days, so lock lengths match the reward tables. */
export const monthsToSeconds = (months: number) => BigInt(Math.round((months * 365 * 86400) / 12));
const multToBps = (m: string) => Math.round(Number(m) * 10_000);

export function reward(amount: bigint, ratePerUnit: bigint, unit: bigint, multBps: number, duration: bigint) {
  if (unit === 0n) return 0n;
  return (amount * ratePerUnit * BigInt(multBps) * duration) / (unit * 10_000n * YEAR);
}

function num(s: string, field: string, errors: string[], decimals: number, allowEmpty = false): bigint {
  const t = s.replace(/[, _]/g, '');
  if (t === '' && allowEmpty) return 0n;
  if (!/^\d*\.?\d+$/.test(t)) {
    errors.push(`${field}: enter a number`);
    return 0n;
  }
  try {
    return parseUnits(t, decimals);
  } catch {
    errors.push(`${field}: too many decimals`);
    return 0n;
  }
}

export function buildConfig(form: PoolForm, net: NetworkConfig, rewardDecimals: number | undefined, nowMs = Date.now()) {
  const errors: string[] = [];
  if (!isAddress(form.rewardToken)) errors.push('Reward token: enter a token address');
  else if (rewardDecimals === undefined) errors.push('Reward token: not an ERC-20 on ' + net.l1.name);
  if (net.stakeAssets.some((a) => a.token.toLowerCase() === form.rewardToken.toLowerCase())) {
    errors.push('Reward token cannot be a stake asset');
  }
  const rDec = rewardDecimals ?? 18;

  const startMs = new Date(form.start).getTime();
  const endMs = new Date(form.end).getTime();
  const epochDays = Number(form.epochDays);
  if (!Number.isFinite(startMs) || startMs < nowMs + 2 * 60_000) errors.push('Deposit start must be at least 2 minutes from now');
  if (!Number.isFinite(endMs) || endMs <= startMs) errors.push('Deposit end must be after start');
  if (!(epochDays >= 1)) errors.push('Epoch length must be at least 1 day');
  const epoch = BigInt(Math.round(epochDays * 86400));

  const minMonths = ((epochDays + PREFETCH_WINDOW_DAYS) * 12) / 365;
  const lockOptions = form.locks.map((l, i) => {
    const months = Number(l.months);
    const multBps = multToBps(l.mult);
    if (!(months > 0)) errors.push(`Lock ${i + 1}: enter months`);
    else if (months < minMonths) errors.push(`Lock ${i + 1}: must be at least ${minMonths.toFixed(1)} months (epoch + 30-day pre-fetch)`);
    if (!(multBps > 0)) errors.push(`Lock ${i + 1}: multiplier must be above 0`);
    return { duration: monthsToSeconds(months || 0), multBps };
  });
  if (lockOptions.length === 0) errors.push('Add at least one lock option');

  const enabled = net.stakeAssets.filter((a) => form.sleeves[a.symbol]?.enabled);
  if (enabled.length === 0) errors.push('Enable at least one stake asset');

  const sleeves = enabled.map((a: StakeAsset) => {
    const f = form.sleeves[a.symbol];
    const p = `${a.symbol}`;
    // Stored per 1,000,000 tokens so small per-token rates stay exact: rate(1M) = perToken × 10^(rDec + 6).
    const unit = parseUnits(RATE_UNIT_TOKENS, a.decimals);
    const ratePerUnit = num(f.perToken, `${p} reward per ${a.symbol}`, errors, rDec + 6);
    const cap = num(f.cap, `${p} cap`, errors, a.decimals);
    const minPerWallet = num(f.minPerWallet, `${p} min per stake`, errors, a.decimals, true);
    const maxPerWallet = num(f.maxPerWallet, `${p} max per wallet`, errors, a.decimals, true);
    if (ratePerUnit === 0n || cap === 0n) errors.push(`${p}: reward per ${a.symbol} and pool cap must be above 0`);
    if (maxPerWallet !== 0n && maxPerWallet < minPerWallet) errors.push(`${p}: max per wallet is below min per stake`);
    const tiers = [{ kind: 0, minPerWallet, maxPerWallet, amounts: [] as bigint[], multBps: [] as number[], lockOptionId: 0 }];
    if (f.fixedEnabled) {
      const amounts = f.fixedAmounts
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((x, i) => num(x, `${p} Alpha bracket ${i + 1}`, errors, a.decimals));
      // One multiplier for all amounts, or one per amount (e.g. Alpha: 1, 2, 3, 5).
      const ms = f.fixedMult.split(/[,\s]+/).filter(Boolean).map(multToBps);
      const multBps = ms.length === 1 ? amounts.map(() => ms[0]) : ms;
      if (amounts.length === 0) errors.push(`${p}: Alpha needs at least one bracket`);
      if (multBps.length !== amounts.length) errors.push(`${p}: give one multiplier, or one per Alpha bracket (${amounts.length})`);
      if (multBps.some((m) => !(m > 0))) errors.push(`${p}: Alpha multipliers must be above 0`);
      if (f.fixedLock >= lockOptions.length) errors.push(`${p}: Alpha lock does not exist`);
      for (let i = 1; i < amounts.length; i++) {
        if (amounts[i] <= amounts[i - 1]) errors.push(`${p}: Alpha bracket starts must go up (${f.fixedAmounts})`);
      }
      const maxPerStake = num(f.fixedMax, `${p} Alpha max per stake`, errors, a.decimals, true);
      if (maxPerStake !== 0n && amounts.length > 0 && maxPerStake < amounts[0]) errors.push(`${p}: Alpha max is below its first bracket`);
      tiers.push({ kind: 2, minPerWallet: 0n, maxPerWallet: maxPerStake, amounts, multBps, lockOptionId: f.fixedLock });
    }
    return { stakeToken: a.token, unit, ratePerUnit, cap, tiers };
  });

  const budget = num(form.budget || '0', 'Initial budget', errors, rDec);
  if (budget === 0n) errors.push('Initial budget must be above 0');

  // Budget needed if every sleeve fills its cap at the best lock.
  const best = lockOptions.reduce((m, l) => (BigInt(l.multBps) * l.duration > m ? BigInt(l.multBps) * l.duration : m), 0n);
  const fullCapReward = sleeves.reduce(
    (sum, s) => sum + (s.unit === 0n ? 0n : (s.cap * s.ratePerUnit * best) / (s.unit * 10_000n * YEAR)),
    0n,
  );

  const cfg: PoolConfig = {
    rewardToken: (isAddress(form.rewardToken) ? form.rewardToken : '0x0000000000000000000000000000000000000000') as Address,
    sleeves,
    lockOptions,
    depositStart: BigInt(Math.floor(startMs / 1000) || 0),
    depositEnd: BigInt(Math.floor(endMs / 1000) || 0),
    epochLength: epoch,
    morBoost: form.morBoost,
  };
  return { cfg, errors, budget, fullCapReward };
}
