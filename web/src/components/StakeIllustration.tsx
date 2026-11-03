'use client';

import { useI18n } from '@/i18n/I18nProvider';

/** Outline clip art for the landing page: stake USDC → locked for x months → unstake: USDC back + a crowned
 * OG Token. Transparent background; strokes follow the text colour, the reward follows the accent. */
export function StakeIllustration({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const ink = 'currentColor';
  const accent = '#20dc8e';
  const stroke = { fill: 'none', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  const usdc = (cx: number, cy: number, r: number) => (
    <g {...stroke} stroke={ink}>
      <circle cx={cx} cy={cy} r={r} />
      {/* $ sign */}
      <path
        d={`M${cx + r * 0.22} ${cy - r * 0.28} C ${cx + r * 0.1} ${cy - r * 0.42}, ${cx - r * 0.34} ${cy - r * 0.4}, ${cx - r * 0.3} ${cy - r * 0.14}
            C ${cx - r * 0.26} ${cy + r * 0.04}, ${cx + r * 0.3} ${cy - r * 0.02}, ${cx + r * 0.3} ${cy + r * 0.18}
            C ${cx + r * 0.32} ${cy + r * 0.42}, ${cx - r * 0.14} ${cy + r * 0.44}, ${cx - r * 0.24} ${cy + r * 0.28}`}
      />
      <path d={`M${cx} ${cy - r * 0.55} V ${cy + r * 0.55}`} />
    </g>
  );

  const arrow = (x1: number, x2: number, y: number, label: string) => (
    <g>
      <path d={`M${x1} ${y} H ${x2}`} {...stroke} stroke={ink} strokeDasharray="2 7" />
      <path d={`M${x2 - 10} ${y - 8} L ${x2} ${y} L ${x2 - 10} ${y + 8}`} {...stroke} stroke={ink} />
      <text x={(x1 + x2) / 2} y={y - 16} textAnchor="middle" fontSize="15" fontWeight="600" fill={ink}>
        {label}
      </text>
    </g>
  );

  return (
    <svg
      viewBox="0 0 710 210"
      className={className}
      role="img"
      aria-label={t('ill.aria')}
    >
      {/* 1 · USDC */}
      {usdc(70, 105, 42)}
      <text x={70} y={175} textAnchor="middle" fontSize="14" fill={ink} opacity={0.75}>
        USDC
      </text>

      {arrow(124, 222, 105, t('ill.stake'))}

      {/* 2 · lock + clock */}
      <g {...stroke} stroke={ink}>
        <path d="M262 92 V 74 a 28 28 0 0 1 56 0 V 92" />
        <rect x="246" y="92" width="88" height="70" rx="12" />
        <circle cx="290" cy="122" r="8" />
        <path d="M290 130 V 144" />
      </g>
      <g {...stroke} stroke={accent}>
        <circle cx="336" cy="74" r="20" fill="none" />
        <path d="M336 62 V 74 L 345 80" />
      </g>
      <text x={290} y={190} textAnchor="middle" fontSize="14" fill={ink} opacity={0.75}>
        {t('ill.locked')}
      </text>

      {arrow(372, 470, 105, t('ill.unstake'))}

      {/* 3 · USDC back + OG Token (crown in the middle of the coin) */}
      {usdc(520, 108, 38)}
      <text x={588} y={118} textAnchor="middle" fontSize="30" fontWeight="600" fill={ink}>
        +
      </text>
      <g {...stroke} stroke={accent}>
        <circle cx="656" cy="108" r="38" />
        {/* simple king crown */}
        <path d="M638 121 L 641 99 L 649 109 L 656 93 L 663 109 L 671 99 L 674 121 Z" />
        <path d="M638 127 H 674" />
        <circle cx="641" cy="96" r="2" fill={accent} />
        <circle cx="656" cy="90" r="2.2" fill={accent} />
        <circle cx="671" cy="96" r="2" fill={accent} />
      </g>
      <text x={520} y={172} textAnchor="middle" fontSize="14" fill={ink} opacity={0.75}>
        {t('ill.back', { sym: 'USDC' })}
      </text>
      <text x={656} y={172} textAnchor="middle" fontSize="14" fontWeight="600" fill={accent}>
        {t('ill.og')}
      </text>
    </svg>
  );
}
