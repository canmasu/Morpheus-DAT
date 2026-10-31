import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="max-w-2xl space-y-4">
        <p className="text-sm font-medium text-mor">Morpheus DAT · an exchange of yield</p>
        <h1 className="text-4xl font-semibold tracking-tight text-white">
          Stake USDC or stETH. Keep your principal. Earn Partner Tokens.
        </h1>
        <p className="text-slate-400">
          Capital Contributors give the yield on their stake and receive a Partner Token, fixed at stake time.
          Partners fund a pool with their own token and receive MOR from Morpheus Capital.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['Contributors', 'Pick a pool, a lock of 12 to 60 months and an amount. The exact reward is reserved when you stake. Principal comes back in full at unlock.'],
          ['Partners', 'Fund a pool with your token. Receive MOR on Arbitrum, minus the DAT fee.'],
          ['Principal safety', 'Rewards never depend on Morpheus. Principal can only return to its own pool, then its owner.'],
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
