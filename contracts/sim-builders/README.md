# Simulated Morpheus Builders (testnet only)

Morpheus's real Builders contracts, unchanged, so Partners can try MOR pools on Base Sepolia without waiting for test MOR.
`src/morpheus` is copied from MorpheusAIs/SmartContracts at commit `a4a8083c5029d4bab9a4724c5c6fabfd40d81e3d` (branch `feature/v4-builders`, MIT licence).
`src/SimSetup.sol` wires them together with mainnet's settings and a stand-in for the rest of Morpheus's stake.

Never deploy this to mainnet. Mainnet pools use Morpheus's own deployment.

```
npm install --ignore-scripts && forge build   # then, in web/: npm run sync-contracts
```
