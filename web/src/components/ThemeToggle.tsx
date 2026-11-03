'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

/** Switches between the Dark and Day themes. The choice is kept in this browser. */
export function ThemeToggle() {
  const { t } = useI18n();
  const [day, setDay] = useState(false);
  useEffect(() => setDay(document.documentElement.dataset.theme === 'day'), []);

  const toggle = () => {
    const next = !day;
    setDay(next);
    if (next) document.documentElement.dataset.theme = 'day';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('dat-theme', next ? 'day' : 'dark');
    } catch {
      // the theme still applies for this visit
    }
  };

  const label = day ? t('theme.dark') : t('theme.day');
  return (
    <button onClick={toggle} aria-label={label} title={label} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-line text-slate-200 hover:bg-white/5">
      {day ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
