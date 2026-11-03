'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectLocale, LOCALES, type Locale } from './locales';
import { en, type MessageKey } from './messages/en';
import { MESSAGES } from './messages';
import { load, save } from '@/lib/storage';
import { setMonthsFormat } from '@/lib/format';

type Vars = Record<string, string | number>;
type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (key: MessageKey, vars?: Vars) => string };

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
const translate = (locale: Locale, key: MessageKey, vars?: Vars) => fill(MESSAGES[locale]?.[key] ?? en[key], vars);

const I18nContext = createContext<Ctx>({ locale: 'en', setLocale: () => {}, t: (k, v) => translate('en', k, v) });
export const useI18n = () => useContext(I18nContext);

const STORAGE_KEY = 'dat-locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Saved choice first; otherwise the browser's languages on a first visit.
  useEffect(() => {
    const saved = load<Locale>(STORAGE_KEY);
    if (saved && LOCALES.some((l) => l.code === saved)) setLocaleState(saved);
    else if (typeof navigator !== 'undefined') setLocaleState(detectLocale(navigator.languages ?? [navigator.language]));
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALES.find((l) => l.code === locale)?.html ?? 'en';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    save(STORAGE_KEY, l);
  }, []);

  const t = useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
  // Plain helpers outside React (e.g. "12 months" in shared formatters) follow the same language.
  setMonthsFormat((n) => translate(locale, 'common.months', { n }));

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
