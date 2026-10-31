'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { ConnectButton } from './ConnectButton';
import { useNetwork } from './Providers';
import { isAdmin } from '@/config/admin';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/contracts/', label: 'Contracts' },
];

export function Header() {
  const path = usePathname();
  const { address } = useAccount();
  const { net } = useNetwork();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const admin = mounted && isAdmin(address);

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
      {net.name === 'testnet' && (
        <div className="bg-amber-500/15 py-1 text-center text-xs font-medium text-amber-300">
          TESTNET · {net.l1.name} + {net.l2.name} · tokens have no value
        </div>
      )}
      <header className="border-b border-ink-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="font-semibold tracking-tight text-white">
              Morpheus <span className="text-mor">DAT</span>
            </Link>
            <nav className="hidden gap-6 sm:flex">
              {NAV.map((n) => link(n.href, n.label))}
              {admin && link('/admin/deploy/', 'Admin')}
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>
    </>
  );
}
