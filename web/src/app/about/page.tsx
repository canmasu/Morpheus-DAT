'use client';

import { GITHUB_AUTHOR, GITHUB_FORK, GITHUB_ISSUES, GITHUB_LICENSE, GITHUB_REPO } from '@/config/links';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages/en';

const CARDS: [MessageKey, MessageKey][] = [
  ['about.useT', 'about.useD'],
  ['about.joinT', 'about.joinD'],
  ['about.reviewT', 'about.reviewD'],
  ['about.statusT', 'about.statusD'],
];

export default function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-sm font-medium text-mor">{t('about.kicker')}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{t('about.title')}</h1>
        <p className="mt-3 text-slate-400">{t('about.intro')}</p>
        <p className="mt-3 text-sm text-slate-300">
          {t('about.startedBy')}{' '}
          <a className="text-mor hover:underline" href={GITHUB_AUTHOR} target="_blank" rel="noreferrer">
            @canmasu ↗
          </a>
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a className="btn-primary" href={GITHUB_REPO} target="_blank" rel="noreferrer">
            {t('about.github')}
          </a>
          <a className="btn-ghost" href={GITHUB_FORK} target="_blank" rel="noreferrer">
            {t('about.fork')}
          </a>
          <a className="btn-ghost" href={GITHUB_ISSUES} target="_blank" rel="noreferrer">
            {t('about.issue')}
          </a>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map(([title, text]) => (
          <section key={title} className="card">
            <h2 className="mb-2 font-medium text-white">{t(title)}</h2>
            <p className="text-sm leading-relaxed text-slate-400">{t(text)}</p>
          </section>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {t('about.independent')}{' '}
        <a className="text-mor hover:underline" href={GITHUB_LICENSE} target="_blank" rel="noreferrer">
          {t('footer.license')}
        </a>
      </p>
    </div>
  );
}
