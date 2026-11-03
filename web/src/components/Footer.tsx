'use client';

import { useI18n } from '@/i18n/I18nProvider';

export function Footer() {
  const { t } = useI18n();
  return <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-slate-500">{t('footer.text')}</footer>;
}
