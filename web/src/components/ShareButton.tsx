'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

/** Share a pool: copy, X, Telegram, or the device's own share sheet. */
export function ShareButton({ text, url }: { text: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => setCanNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const full = `${text}\n${url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the text stays visible to copy by hand
    }
  };

  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost rounded-full" onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
          <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
        {t('share.button')}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-2xl border border-ink-line bg-ink-soft p-4 shadow-xl">
          <div className="text-xs text-slate-500">{t('share.title')}</div>
          <p className="whitespace-pre-line rounded-lg bg-ink p-3 text-sm text-slate-200">{text}</p>
          <p className="mono break-all text-slate-500">{url}</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" onClick={copy}>
              {copied ? t('share.copied') : t('share.copy')}
            </button>
            <a
              className="btn-ghost"
              target="_blank"
              rel="noreferrer"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
            >
              {t('share.x')}
            </a>
            <a
              className="btn-ghost"
              target="_blank"
              rel="noreferrer"
              href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}
            >
              Telegram
            </a>
            {canNative && (
              <button className="btn-ghost" onClick={() => navigator.share({ text, url }).catch(() => {})}>
                {t('share.more')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
