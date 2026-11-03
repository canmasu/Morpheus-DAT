import { formatUnits } from 'viem';

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export const fmt = (v: bigint, decimals: number, max = 4) =>
  Number(formatUnits(v, decimals)).toLocaleString(undefined, { maximumFractionDigits: max });

export const fmtDate = (s: bigint) => new Date(Number(s) * 1000).toLocaleString();

let monthsFormat = (n: string) => `${n} months`;
/** Set by the language provider so "12 months" follows the chosen language. */
export const setMonthsFormat = (f: (n: string) => string) => {
  monthsFormat = f;
};

export const months = (seconds: bigint) => {
  const m = (Number(seconds) * 12) / (365 * 86400);
  return monthsFormat(Number.isInteger(Math.round(m * 10) / 10) ? String(Math.round(m)) : m.toFixed(1));
};

/** Just the number of months, e.g. "12" or "1.1". */
export const monthsNum = (seconds: bigint) => {
  const m = (Number(seconds) * 12) / (365 * 86400);
  return Number.isInteger(Math.round(m * 10) / 10) ? String(Math.round(m)) : m.toFixed(1);
};

export function countdown(to: bigint, now = Date.now() / 1000) {
  let s = Math.max(0, Number(to) - Math.floor(now));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

/** 1,000,000 → "1M", 10,000 → "10K". */
export const fmtCompact = (v: bigint, decimals: number) =>
  Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(Number(formatUnits(v, decimals)));
