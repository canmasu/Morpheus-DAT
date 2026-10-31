# Morpheus DAT — contracts

Foundry workspace for the DAT pool platform on Morpheus Capital. Spec: [`../docs/proposal.md`](../docs/proposal.md).

## Layout

| Chain | Contract | License | Role |
|---|---|---|---|
| Ethereum | `PoolFactory` | BUSL-1.1 | creates pools; fee, referral, featured, pause, adapter timelock |
| Ethereum | `PoolVault` | BUSL-1.1 | one clone per pool: sleeves (USDC, stETH), tiers, locks, reward reservation, exits |
| Ethereum | `CapitalAccount` | MIT | one Morpheus depositor per (sleeve × 30-day epoch × lock option) |
| Ethereum | `MorpheusAdapter` / `ExitOnlyAdapter` | MIT | encodes Morpheus calls, circuit-breaker baseline |
| Ethereum | `OTCMarket` | BUSL-1.1 | fixed-price escrow listings, partial fills, optional KYC / private taker |
| Arbitrum | `ArbFeeConfig` | BUSL-1.1 | DAT fee (20% cap, 48h timelock) and fee wallet |
| Arbitrum | `MorSplitter` + `SplitterDeployer` | BUSL-1.1 | per-pool MOR receiver at a CREATE2 address predicted on Ethereum |

## Commands

```sh
forge build
forge test                                    # unit + fuzz tests on mocks (fork tests skip)
ETH_RPC_URL=<mainnet rpc> forge test --match-path 'test/fork/*' -vv   # live Morpheus v7
```

## Design notes

- **Adapter pattern.** Morpheus uses `msg.sender` as the depositor, so the adapter cannot call Morpheus itself. It returns calldata that the CapitalAccount runs against its own DepositPool (fixed at init). Stake tokens can only leave an account to Morpheus's distributor (exact allowance, reset after) or to its vault, so no adapter can redirect principal. **MOR routing does trust the adapter**: a malicious adapter could encode `claim(idx, attacker)`. That is why non-exit adapters sit behind the 48h timelock.
- **Circuit breaker.** The adapter records each DepositPool's `version`, `distributor`, lock periods and `minimalStake`. Any change blocks new stakes until the multisig calls `recordBaseline` again after a fork test. Exits are not affected.
- **Ledger vs balance.** Positions record what actually arrived (balance delta, so stETH's 1-wei loss counts). Payouts send the recorded amount from the vault. A DAT-funded dust reserve covers Aave and stETH rounding; if a real shortfall happens (slashing, or the reserve isn't funded), it is shared pro rata.
- **Validation.** Each lock must be at least `epochLength + 30 days`, so an account closes before its pre-fetch window opens.

## Live Morpheus findings (mainnet fork, block ~26.31M, 31 Oct 2026)

| Setting | USDC pool | stETH pool | Doc assumed |
|---|---|---|---|
| `version()` | 7 | 7 | 7 |
| public reward pool index | 0 | 0 | 0 |
| `withdrawLockPeriodAfterStake` | 7 days | 7 days | ~7 days |
| `claimLockPeriodAfterStake` | **14 days** | **14 days** | 90 days |
| `claimLockPeriodAfterClaim` | 14 days | 14 days | unknown |
| `minimalStake` | 1 USDC | 0.01 stETH | unknown |
| LayerZero fee per MOR claim | ≈0.00048 ETH | — | unknown |
| referrer tiers (multiplier) | 3% / 5% / 10% / 15% | same | same |

Also found: Morpheus `stake` and `withdraw` revert (`DR: price for pair is zero`) when any Chainlink feed in the reward pool goes stale. That is a real-world trigger for **Exit pending**, which `withdraw` → `processExit` already handles.

## Not built yet

- Deploy scripts (`script/`) writing `deployments/<network>.json`, and the Sepolia setup
- `RewardVault` for remote reward chains (v1.1)
- BUSL-1.1 license text (licensor, change date, Additional Use Grant), pending legal review
- Invariant test harness (handler-based), plus an upgrade drill that swaps in a Morpheus implementation with renamed functions
