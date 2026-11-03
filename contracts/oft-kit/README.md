# Alpha Coin bridge kit (formerly OG Token)

Lets a Partner bring a token from another EVM chain to Base with LayerZero's standard OFT contracts, then fund a MOR pool
with it. The Partner deploys and owns everything; DAT never holds the tokens or controls the bridge.

- `OGTokenAdapter`: on the token's home chain, locks tokens. LayerZero's OFTAdapter plus one check that rejects taxed tokens.
- `OGTokenOFT`: on Base, LayerZero's OFT unchanged.
- `OGBridgeRegistry`: on Base, deploys the OFT, records the Partner's acceptance of the terms, and lets the site find the bridge.

```
npm install --ignore-scripts --legacy-peer-deps && forge build   # then, in web/: npm run sync-contracts
BSC_RPC_URL=... BASE_RPC_URL=... forge test -vv
```
