import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { TxToasts } from '@/components/TxToasts';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Morpheus DAT',
  description: 'Farm your stETH, stablecoins and MOR to earn Alpha Coins.',
};

const THEME_SCRIPT = `try{var t=new URLSearchParams(location.search).get('theme')||localStorage.getItem('dat-theme');if(t==='day')document.documentElement.dataset.theme='day'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme is set before first paint so Day users never see a dark flash; the script changes this attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
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
