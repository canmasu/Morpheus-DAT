'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { LOCALES, type Locale } from '@/i18n/locales';

/** Header button (e.g. "EN") that opens a "Select a language" panel grouped by region. */
export function LanguagePicker() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const el = scroller.current;
    const check = () => el && setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    check();
    el?.addEventListener('scroll', check);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      el?.removeEventListener('scroll', check);
    };
  }, [open]);

  const choose = (l: Locale) => {
    setLocale(l);
    setOpen(false);
  };

  const item = (l: (typeof LOCALES)[number]) => (
    <button
      key={l.code}
      lang={l.html}
      onClick={() => choose(l.code)}
      className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[15px] transition hover:bg-white/5 ${
        l.code === locale ? 'text-white' : 'text-slate-300'
      }`}
    >
      {l.name}
      {l.code === 'en' && <span className="text-slate-400">{t('lang.default')}</span>}
      {l.code === locale && <span className="text-mor">✓</span>}
    </button>
  );

  const group = (title: string, g: 'europe' | 'latam' | 'asia') => (
    <section className="mt-8">
      <h3 className="mb-3 text-xl font-medium text-white">{title}</h3>
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">{LOCALES.filter((l) => l.group === g).map(item)}</div>
    </section>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t('lang.button')}
        className="rounded-full border border-ink-line px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
      >
        {current.short}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('lang.title')}
            className="relative w-full max-w-2xl rounded-2xl border border-ink-line bg-ink-soft shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              aria-label={t('lang.close')}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-slate-400 hover:bg-white/5 hover:text-white"
            >
              ×
            </button>
            <div ref={scroller} className="max-h-[80vh] overflow-y-auto px-6 pb-8 pt-8 sm:px-10">
              <h2 className="mb-6 text-3xl font-semibold tracking-tight text-white">{t('lang.title')}</h2>
              {LOCALES.filter((l) => l.group === 'default').map(item)}
              {group(t('lang.europe'), 'europe')}
              {group(t('lang.latam'), 'latam')}
              {group(t('lang.asia'), 'asia')}
            </div>
            {more && (
              <div className="pointer-events-none absolute bottom-3 right-5 text-xl text-slate-400" aria-hidden>
                ↓
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
