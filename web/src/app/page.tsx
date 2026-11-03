'use client';

import Link from 'next/link';
import { StakeIllustration } from '@/components/StakeIllustration';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages/en';

const CARDS: [MessageKey, MessageKey][] = [
  ['home.farmers.title', 'home.farmers.text'],
  ['home.partners.title', 'home.partners.text'],
  ['home.safe.title', 'home.safe.text'],
];

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="space-y-12">
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0 space-y-4">
          <p className="text-sm font-medium text-mor">{t('home.kicker')}</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">{t('home.title')}</h1>
          <p className="text-slate-400">{t('home.sub')}</p>
          <Link href="/pools/" className="btn-primary">
            {t('home.browse')}
          </Link>
        </div>
        <StakeIllustration className="h-auto w-full min-w-0 max-w-full text-slate-300" />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {CARDS.map(([title, text]) => (
          <div key={title} className="card">
            <h3 className="mb-2 font-medium text-white">{t(title)}</h3>
            <p className="text-sm text-slate-400">{t(text)}</p>
          </div>
        ))}
      </section>
      <p className="text-sm text-slate-500">
        <Link className="text-mor hover:underline" href="/pools/">
          {t('home.browse')}
        </Link>{' '}
        ·{' '}
        <Link className="text-mor hover:underline" href="/contracts/">
          {t('home.contracts')}
        </Link>
      </p>
    </div>
  );
}
