import type { PoolDetail } from './vault';
import { refAmount } from './vault';
import { baseMultBps, fmtMult, reward } from './pool';
import { countdown, months, monthsNum } from './format';

const YEAR = 365n * 86400n;

/** Figures shared by the pool card and the pools table. */
export function summarizePool(p: PoolDetail, chainNow: number) {
  const now = BigInt(chainNow);
  const status =
    now < p.depositStart
      ? { kind: 'soon' as const, countdown: countdown(p.depositStart, chainNow), tone: 'bg-sky-500/10 text-sky-300' }
      : now < p.depositEnd
        ? { kind: 'open' as const, countdown: '', tone: 'bg-mor/10 text-mor' }
        : { kind: 'closed' as const, countdown: '', tone: 'bg-white/5 text-slate-400' };

  // All multipliers in the pool (locks + OG brackets), shown relative to the lowest one.
  const tiers = p.sleeves.flatMap((s) => s.tiers);
  const mults = [...p.locks.map((l) => l.multBps), ...tiers.filter((t) => t.kind !== 0).flatMap((t) => [...t.multBps])];
  const minMult = Math.min(...mults);
  const maxMult = Math.max(...mults);
  const base = baseMultBps(p.locks, tiers);

  const shortest = p.locks.reduce((a, b) => (b.duration < a.duration ? b : a), p.locks[0]);
  const longest = p.locks.reduce((a, b) => (b.duration > a.duration ? b : a), p.locks[0]);
  const lockRange =
    shortest.duration === longest.duration
      ? months(shortest.duration)
      : `${monthsNum(shortest.duration)} – ${months(longest.duration)}`;

  const sleeves = p.sleeves.map((s) => {
    const ref = refAmount(s);
    // This coin's own range: another coin's OG brackets do not apply to it. The 1x stays pool-wide, as on the stake page.
    const own = [...p.locks.map((l) => l.multBps), ...s.tiers.filter((t) => t.kind !== 0).flatMap((t) => [...t.multBps])];
    const lo = Math.min(...own);
    const hi = Math.max(...own);
    return {
      sleeve: s,
      ref,
      multRange: `${fmtMult(lo, base)} – ${fmtMult(hi, base)}`,
      lo: reward(ref, s.ratePerUnit, s.unit, lo, YEAR),
      hi: reward(ref, s.ratePerUnit, s.unit, hi, YEAR),
      filled: s.cap === 0n ? 0 : Number((s.totalStaked * 1_000_000n) / s.cap) / 1_000_000,
    };
  });

  return { status, multRange: `${fmtMult(minMult, base)} – ${fmtMult(maxMult, base)}`, lockRange, sleeves };
}

export const pct = (ratio: number) => `${ratio > 0 && ratio < 0.001 ? '<0.1' : (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;

/** Translated status label: t('status.open' | 'status.opensIn' | 'status.closed'). */
export const statusLabel = (
  s: { kind: 'soon' | 'open' | 'closed'; countdown: string },
  t: (k: 'status.open' | 'status.opensIn' | 'status.closed', v?: Record<string, string>) => string,
) => (s.kind === 'soon' ? t('status.opensIn', { t: s.countdown }) : s.kind === 'open' ? t('status.open') : t('status.closed'));
