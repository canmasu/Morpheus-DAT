import Link from 'next/link';
import { StakeIllustration } from '@/components/StakeIllustration';

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0 space-y-4">
        <p className="text-sm font-medium text-mor">Morpheus DAT · an exchange of yield</p>
        <h1 className="text-4xl font-semibold tracking-tight text-white">
          Stake USDC, USDT or stETH. Get your full stake back at unlock. Receive Partner Tokens.
        </h1>
        <p className="text-slate-400">
          Capital Contributors give the yield on their stake and receive a Partner Token, fixed at stake time.
          Partners fund a pool with their own token and receive MOR from Morpheus Capital.
        </p>
        <Link href="/pools/" className="btn-primary">
          Browse pools
        </Link>
        </div>
        <StakeIllustration className="h-auto w-full min-w-0 max-w-full text-slate-300" />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['Contributors', 'Pick a pool, a lock of 12 to 60 months and an amount. The exact reward is reserved when you stake. Your full stake comes back at unlock.'],
          ['Partners', 'Fund a pool with your token. Receive MOR on Arbitrum, minus the DAT fee.'],
          ['Your stake stays yours', 'Rewards never depend on Morpheus. Staked tokens can only go back to their own pool, then to you.'],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <h3 className="mb-2 font-medium text-white">{t}</h3>
            <p className="text-sm text-slate-400">{d}</p>
          </div>
        ))}
      </section>
      <p className="text-sm text-slate-500">
        <Link className="text-mor hover:underline" href="/pools/">Browse pools</Link> · <Link className="text-mor hover:underline" href="/contracts/">contracts</Link>
      </p>
    </div>
  );
}
