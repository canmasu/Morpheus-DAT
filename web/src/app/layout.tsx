import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { TxToasts } from '@/components/TxToasts';

export const metadata: Metadata = {
  title: 'Morpheus DAT',
  description: 'Stake USDC or stETH. Keep your principal. Earn Partner Tokens.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-slate-500">
            Morpheus DAT — an independent platform built on Morpheus Capital.
          </footer>
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}
