import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Every themed colour reads a CSS variable set in globals.css, so pages follow the Dark / Day theme on their own.
      // `white` and the slate scale mean "strongest text" down to "faintest text"; in Day they run dark to light.
      colors: {
        white: v('white'),
        slate: { 100: v('slate-100'), 200: v('slate-200'), 300: v('slate-300'), 400: v('slate-400'), 500: v('slate-500'), 600: v('slate-600') },
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), line: v('ink-line'), hover: v('ink-hover') },
        mor: { DEFAULT: v('mor'), dim: '#14935e' },
        'on-mor': v('on-mor'),
        amber: { 300: v('amber-300') },
        red: { 300: v('red-300'), 400: v('red-400') },
        sky: { 300: v('sky-300') },
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
