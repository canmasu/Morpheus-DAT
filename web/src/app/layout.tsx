import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { TxToasts } from '@/components/TxToasts';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Morpheus DAT',
  description: 'Farm your stETH, stablecoins and MOR to earn OG Tokens.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
          <Footer />
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}
