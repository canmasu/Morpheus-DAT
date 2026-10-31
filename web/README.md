# Morpheus DAT — web

Next.js static site (wagmi + viem, browser wallet only).

```sh
npm install
npm run dev              # http://localhost:3000
npm run build            # static export to out/
npm run sync-contracts   # after `forge build` in ../contracts, refreshes src/contracts/artifacts.ts
```

## Pages

| Route | Who | What |
|---|---|---|
| `/` | everyone | landing |
| `/contracts` | everyone | DAT + Morpheus addresses for the selected network |
| `/admin` | admin wallets | admin home |
| `/admin/deploy` | admin wallets | runs the full deployment from the connected wallet |

Admin wallets are listed in `src/config/admin.ts`. This only gates the UI; on-chain roles decide what a wallet can change.

## Deploying from the browser

1. Connect an admin wallet with ETH on both chains (testnet: Sepolia ETH + Arbitrum Sepolia ETH).
2. `/admin/deploy` → pick Testnet or Mainnet → check the fee wallet, referral wallet and role holders.
3. **Run all remaining.** Your wallet switches chains as needed: 3 contracts on Arbitrum, then 6 on Ethereum, then role grants. You confirm each transaction (about 12 in total).
4. Health checks must be all green.
5. **Download `<network>.json`** and commit it as `src/deployments/<network>.json`.

Progress is kept in the browser, so a rejected or failed transaction can be retried with **Run next step**.

Dry run against local forks, impersonating the admin wallet:

```sh
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8545 --chain-id 11155111
anvil --fork-url https://arbitrum-sepolia-rpc.publicnode.com --port 8546 --chain-id 421614 --gas-limit 30000000
cast rpc anvil_setBalance 0x1ADe0588fC195d7809Ef334919023e3C2E6570C5 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8545   # and :8546
npx tsx scripts/dry-run-deploy.ts
```
