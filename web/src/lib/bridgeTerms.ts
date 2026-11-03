import { keccak256, toBytes } from 'viem';

/** Mainnet stays blocked until a lawyer has approved TERMS_TEXT. Testnet shows it as a draft. */
export const TERMS_APPROVED = false;

/** DRAFT, not legal advice. A lawyer must review this before mainnet: whether it holds depends on the Partner's and
 * Morpheus DAT's jurisdictions. Changing a word changes the hash recorded on-chain, so bump the version too. */
export const TERMS_TEXT = `Morpheus DAT bridge setup terms, version 1 (DRAFT)

1. You deploy and own the bridge. The contracts are deployed from your wallet and owned by you or your multisig. Morpheus DAT does not hold your tokens, cannot move them, and cannot change, pause or repair your bridge.

2. Software only. Morpheus DAT provides this setup tool as software, "as is", without warranty of any kind. It is not a bridge operator, custodian, broker or adviser. The bridge runs on LayerZero and on third-party verifiers that Morpheus DAT does not control.

3. Your risks. You accept that bridges can fail or be attacked and that tokens can be lost or delayed, including tokens locked on the home chain and tokens held by Farmers. Causes include bugs in any contract, failure or compromise of LayerZero or a verifier, misconfiguration, loss of your owner keys, and network outages.

4. Your responsibility. You are solely responsible for: having the right to bridge the token; securing your owner keys; every change you make to the bridge after setup; what you tell your community and Farmers about the bridge; and complying with all laws that apply to you and your token, including securities, sanctions and tax laws.

5. Your liability. To the fullest extent the law allows, Morpheus DAT and its contributors are not liable for any loss arising from your bridge or token, and you will cover any claim brought against them by third parties that arises from your bridge or token.

6. Record. Your wallet's acceptance of these terms is recorded publicly on Base, as a hash of this text.`;

export const TERMS_HASH = keccak256(toBytes(TERMS_TEXT));
