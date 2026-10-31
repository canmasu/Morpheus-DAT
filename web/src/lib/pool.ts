import { type Address, isAddress, parseUnits } from 'viem';
import type { NetworkConfig, StakeAsset } from '@/config/networks';

export const YEAR = 365n * 86400n;
export const PREFETCH_WINDOW_DAYS = 30;

export type LockRow = { months: string; mult: string };
export type SleeveForm = {
  enabled: boolean;
  unitAmount: string;
  rate: string;
  cap: string;
  minPerWallet: string;
  maxPerWallet: string;
  fixedEnabled: boolean;
  fixedAmounts: string;
  fixedMult: string;
  fixedLock: number;
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

const SLEEVE_DEFAULTS: Record<string, Partial<SleeveForm>> = {
  USDC: { unitAmount: '1000000', rate: '20000', cap: '10000000', minPerWallet: '1000', maxPerWallet: '5000000', fixedAmounts: '100', fixedMult: '0.05' },
  stETH: { unitAmount: '500', rate: '10000', cap: '5000', minPerWallet: '1', maxPerWallet: '' },
  stETHMock: { unitAmount: '500', rate: '10000', cap: '5000', minPerWallet: '0.01', maxPerWallet: '' },
  LINK: { unitAmount: '10000', rate: '1000', cap: '1000000', minPerWallet: '10', maxPerWallet: '' },
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
      { months: '12', mult: '1.00' },
      { months: '24', mult: '1.10' },
      { months: '36', mult: '1.25' },
      { months: '48', mult: '1.50' },
      { months: '60', mult: '2.50' },
    ],
    sleeves: Object.fromEntries(
      net.stakeAssets.map((a, i) => [
        a.symbol,
        {
          enabled: i === 0,
          unitAmount: '1000',
          rate: '1000',
          cap: '1000000',
          minPerWallet: '1',
          maxPerWallet: '',
          fixedEnabled: false,
          fixedAmounts: '100',
          fixedMult: '1.00',
          fixedLock: 0,
          ...SLEEVE_DEFAULTS[a.symbol],
        } satisfies SleeveForm,
      ]),
    ),
    start: toLocalInput(new Date(now + 15 * 60_000)),
    end: toLocalInput(new Date(now + 180 * 86400_000)),
    epochDays: '30',
    morBoost: true,
    budget: '',
  };
}

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
    const unit = num(f.unitAmount, `${p} rate unit`, errors, a.decimals);
    const ratePerUnit = num(f.rate, `${p} rate`, errors, rDec);
    const cap = num(f.cap, `${p} cap`, errors, a.decimals);
    const minPerWallet = num(f.minPerWallet, `${p} min per stake`, errors, a.decimals, true);
    const maxPerWallet = num(f.maxPerWallet, `${p} max per wallet`, errors, a.decimals, true);
    if (unit === 0n || ratePerUnit === 0n || cap === 0n) errors.push(`${p}: rate unit, rate and cap must be above 0`);
    if (maxPerWallet !== 0n && maxPerWallet < minPerWallet) errors.push(`${p}: max per wallet is below min per stake`);
    const tiers = [{ kind: 0, minPerWallet, maxPerWallet, amounts: [] as bigint[], multBps: [] as number[], lockOptionId: 0 }];
    if (f.fixedEnabled) {
      const amounts = f.fixedAmounts
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((x, i) => num(x, `${p} fixed amount ${i + 1}`, errors, a.decimals));
      const m = multToBps(f.fixedMult);
      if (amounts.length === 0) errors.push(`${p}: fixed tier needs at least one amount`);
      if (!(m > 0)) errors.push(`${p}: fixed tier multiplier must be above 0`);
      if (f.fixedLock >= lockOptions.length) errors.push(`${p}: fixed tier lock does not exist`);
      tiers.push({ kind: 1, minPerWallet: 0n, maxPerWallet: 0n, amounts, multBps: amounts.map(() => m), lockOptionId: f.fixedLock });
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
