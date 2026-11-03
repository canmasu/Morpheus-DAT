'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages/en';

const FARMER = ['what', 'start', 'alpha', 'amount', 'claim', 'back', 'early', 'cost', 'risk'];
const PARTNER = ['why', 'cost', 'setup', 'chain', 'mor', 'budget', 'listed'];

export default function FaqPage() {
  const { t } = useI18n();
  const group = (id: string, title: MessageKey, prefix: string, items: string[], cta: MessageKey, href: string) => (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-xl font-semibold text-white">{t(title)}</h2>
      <div className="divide-y divide-ink-line rounded-2xl border border-ink-line bg-ink-soft">
        {items.map((q, i) => (
          <details key={q} className="group px-5 py-4" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white">
              {t(`faq.${prefix}.${q}.q` as MessageKey)}
              <span className="shrink-0 text-slate-500 transition group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{t(`faq.${prefix}.${q}.a` as MessageKey)}</p>
          </details>
        ))}
      </div>
      <Link href={href} className="btn-primary">
        {t(cta)}
      </Link>
    </section>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">{t('faq.title')}</h1>
        <p className="mt-2 text-slate-400">{t('faq.sub')}</p>
        <div className="mt-4 flex gap-2">
          <a className="btn-ghost" href="#farmers">
            {t('faq.farmers')}
          </a>
          <a className="btn-ghost" href="#partners">
            {t('faq.partners')}
          </a>
        </div>
      </div>
      {group('farmers', 'faq.farmers', 'f', FARMER, 'faq.ctaF', '/pools/')}
      {group('partners', 'faq.partners', 'p', PARTNER, 'faq.ctaP', '/partner/create/')}
    </div>
  );
}
