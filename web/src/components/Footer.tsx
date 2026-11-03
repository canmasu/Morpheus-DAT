'use client';

import Link from 'next/link';
import { GITHUB_ISSUES, GITHUB_LICENSE, GITHUB_REPO } from '@/config/links';
import { useI18n } from '@/i18n/I18nProvider';

export function Footer() {
  const { t } = useI18n();
  const cls = 'text-slate-400 hover:text-white';
  const internal = (href: string, label: string) => (
    <li key={href}>
      <Link className={cls} href={href}>
        {label}
      </Link>
    </li>
  );
  const external = (href: string, label: string) => (
    <li key={href}>
      <a className={cls} href={href} target="_blank" rel="noreferrer">
        {label} ↗
      </a>
    </li>
  );
  const column = (title: string, links: React.ReactNode[]) => (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="space-y-2 text-sm">{links}</ul>
    </div>
  );
  return (
    <footer className="mt-10 border-t border-ink-line">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {column(t('footer.product'), [internal('/pools/', t('nav.pools')), internal('/dashboard/', t('nav.dashboard')), internal('/partner/', t('nav.partners')), internal('/partner/create/', t('partner.create'))])}
          {column(t('footer.learn'), [internal('/faq/', t('nav.faq')), internal('/about/', t('nav.about')), internal('/contracts/', t('nav.contracts'))])}
          {column(t('footer.community'), [external(GITHUB_REPO, 'GitHub'), external(GITHUB_ISSUES, t('footer.issue'))])}
          {column(t('footer.legal'), [internal('/terms/', t('footer.terms')), external(GITHUB_LICENSE, t('footer.license'))])}
        </div>
        <div className="space-y-1 text-xs text-slate-500">
          <p>{t('footer.text')}</p>
          <p>{t('footer.notice')}</p>
        </div>
      </div>
    </footer>
  );
}
