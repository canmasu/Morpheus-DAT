/** Small progress ring for "capacity filled". */
export function CapacityRing({ ratio, size = 18 }: { ratio: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#20dc8e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(filled * c, filled > 0 ? 1.5 : 0)} ${c}`}
      />
    </svg>
  );
}
