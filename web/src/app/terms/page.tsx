import Link from 'next/link';
import { GITHUB_LICENSE } from '@/config/links';

const SECTIONS: [string, string][] = [
  ['1. What this is', 'Morpheus DAT is open source software: a website and smart contracts that anyone can use, copy or run. Using the website or the contracts means you accept these terms.'],
  ['2. Open source licence', 'The code is released under the MIT licence, reproduced below. You may use, copy, change and distribute it for free, as long as you keep the licence notice. Third-party code in the project keeps its own licence.'],
  ['3. No warranty', 'The software is provided "as is", without warranty of any kind. The code has not had a professional audit yet. It can contain bugs that lose funds, and transactions on a blockchain cannot be undone.'],
  ['4. Not financial advice', 'Nothing on this website is financial, investment, legal or tax advice, and nothing here is an offer of any security or investment. Figures shown are calculations from on-chain settings, not promises of value. Alpha Coins may be worth little or nothing.'],
  ['5. You control your wallet', 'You sign every transaction yourself. The contributors do not hold your funds or your keys, and cannot reverse a transaction or recover lost funds.'],
  ['6. Third parties', 'The contracts rely on systems the contributors do not control, including Morpheus, Lido, Aave, LayerZero and each blockchain. Each Partner runs its own pool and chooses its own token. The contributors do not vouch for any Partner or token, and a pool being listed is not a recommendation.'],
  ['7. Your responsibility', 'You must make sure your use is legal where you live, and you are responsible for your own taxes. Do not use this software if it is restricted for you, including under sanctions rules.'],
  ['8. Limit of liability', 'To the fullest extent the law allows, the authors and contributors are not liable for any loss or damage arising from your use of the software, the website or any pool, bridge or token.'],
  ['9. Partners', 'Partners who set up a bridge also accept the separate bridge terms shown on the bridge page.'],
  ['10. Changes', 'These terms may change. The current version is always on this page, and its history is public in the code repository.'],
];

const MIT = `Copyright (c) 2026 canmasu and Morpheus DAT contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** English only: this is the single legal version. DRAFT until a lawyer has reviewed it. */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Terms of use</h1>
        <p className="mt-2 text-sm text-amber-300">Draft for testing. A lawyer must review these before mainnet. English is the only legal version.</p>
      </div>
      {SECTIONS.map(([title, text]) => (
        <section key={title}>
          <h2 className="mb-1 font-medium text-white">{title}</h2>
          <p className="text-sm leading-relaxed text-slate-400">{text}</p>
        </section>
      ))}
      <section className="card">
        <h2 className="mb-2 font-medium text-white">MIT licence</h2>
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-400">{MIT}</pre>
        <a className="mt-3 inline-block text-xs text-mor hover:underline" href={GITHUB_LICENSE} target="_blank" rel="noreferrer">
          LICENSE on GitHub ↗
        </a>
      </section>
      <Link className="text-sm text-mor hover:underline" href="/faq/">
        Questions? Read the FAQ →
      </Link>
    </div>
  );
}
