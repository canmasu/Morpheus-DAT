/** Round token badge. Known stake assets get their brand colour and mark; reward tokens get the crown coin. */
const KNOWN: Record<string, { bg: string; mark: string }> = {
  USDC: { bg: '#2775CA', mark: '$' },
  USDT: { bg: '#26A17B', mark: '₮' },
  stETH: { bg: '#00A3FF', mark: 'Ξ' },
  stETHMock: { bg: '#00A3FF', mark: 'Ξ' },
  LINK: { bg: '#2A5ADA', mark: '⬡' },
};

export function TokenIcon({ symbol, size = 36, reward = false }: { symbol: string; size?: number; reward?: boolean }) {
  if (reward) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-label={symbol} className="shrink-0">
        <circle cx="20" cy="20" r="20" fill="#20dc8e" />
        <circle cx="20" cy="20" r="15.5" fill="none" stroke="#0b0f14" strokeOpacity="0.35" strokeWidth="1.2" />
        <path d="M11.5 25 L 13 15 L 17 19.5 L 20 12.5 L 23 19.5 L 27 15 L 28.5 25 Z" fill="#0b0f14" />
        <rect x="11.5" y="26.3" width="17" height="2.2" rx="1" fill="#0b0f14" />
      </svg>
    );
  }
  const k = KNOWN[symbol] ?? { bg: '#475569', mark: symbol.slice(0, 1).toUpperCase() };
  return (
    <span
      aria-label={symbol}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: k.bg, color: '#fff', fontSize: size * 0.48 }}
    >
      {k.mark}
    </span>
  );
}
