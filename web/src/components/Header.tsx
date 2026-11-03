'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { ConnectButton } from './ConnectButton';
import { useNetwork } from './Providers';
import { isAdmin } from '@/config/admin';
import { NETWORKS, type NetworkName } from '@/config/networks';
import { isLocalHost } from '@/lib/sandbox';
import { LanguagePicker } from './LanguagePicker';
import { ThemeToggle } from './ThemeToggle';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages/en';

// The logo links home; Contracts, Terms and GitHub live in the footer.
const NAV: { href: string; label: MessageKey }[] = [
  { href: '/pools/', label: 'nav.pools' },
  { href: '/dashboard/', label: 'nav.dashboard' },
  { href: '/partner/', label: 'nav.partners' },
  { href: '/faq/', label: 'nav.faq' },
  { href: '/about/', label: 'nav.about' },
];

export function Header() {
  const path = usePathname();
  const { address } = useAccount();
  const { net, setNetwork } = useNetwork();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const admin = mounted && isAdmin(address);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);

  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className={`text-sm ${path === href || (href !== '/' && path?.startsWith(href)) ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      {net.name === 'local' && (
        <div className="bg-sky-500/15 py-1 text-center text-xs font-medium text-sky-300">
          {t('banner.local')}{' '}
          <Link className="underline" href="/sandbox/">
            {t('banner.localLink')}
          </Link>
        </div>
      )}
      {net.name === 'testnet' && (
        <div className="bg-amber-500/15 py-1 text-center text-xs font-medium text-amber-300">
          {t('banner.testnet', { l1: net.l1.name, l2: net.l2.name })}
          {net.builders?.simulated && ` · ${t('banner.simulated')}`}
        </div>
      )}
      <header className="border-b border-ink-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="whitespace-nowrap font-semibold tracking-tight text-white">
              Morpheus <span className="text-mor">DAT</span>
            </Link>
            <nav className="hidden gap-6 sm:flex">
              {NAV.map((n) => link(n.href, t(n.label)))}
              {mounted && net.name === 'local' && link('/sandbox/', t('nav.sandbox'))}
              {admin && link('/admin/', t('nav.admin'))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-line text-slate-200 hover:bg-white/5 sm:hidden"
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
            {mounted && (
              <select
                className="w-[5.5rem] rounded-lg border border-ink-line bg-ink px-1.5 py-2 text-xs text-slate-300 sm:w-auto sm:px-2"
                value={net.name}
                onChange={(e) => setNetwork(e.target.value as NetworkName)}
                aria-label="Network"
              >
                {(Object.keys(NETWORKS) as NetworkName[])
                  .filter((n) => n !== 'local' || isLocalHost())
                  .map((n) => (
                    <option key={n} value={n}>
                      {n === 'testnet' ? 'Testnet' : n === 'local' ? 'Local sandbox' : 'Mainnet'}
                    </option>
                  ))}
              </select>
            )}
            {mounted && <ThemeToggle />}
            {mounted && <LanguagePicker />}
            <ConnectButton />
          </div>
        </div>
        {menuOpen && (
          <nav className="flex flex-col gap-3 border-t border-ink-line px-4 py-4 sm:hidden">
            {NAV.map((n) => link(n.href, t(n.label)))}
            {mounted && net.name === 'local' && link('/sandbox/', t('nav.sandbox'))}
            {admin && link('/admin/', t('nav.admin'))}
          </nav>
        )}
      </header>
    </>
  );
}
