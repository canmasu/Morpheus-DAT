// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Pool configuration shared by PoolFactory, PoolVault and the SDK.
interface IPoolTypes {
    /// @param duration lock length in seconds
    /// @param multBps reward multiplier, 10_000 = 1.00x
    struct LockOption {
        uint64 duration;
        uint32 multBps;
    }

    enum TierKind {
        RANGE,
        FIXED
    }

    /// @dev RANGE: any amount in [minPerWallet, maxPerWallet] (maxPerWallet = 0 means no max), any lock option.
    ///      FIXED: one of `amounts[i]` with multiplier `multBps[i]`, always on `lockOptionId`.
    struct Tier {
        TierKind kind;
        uint256 minPerWallet;
        uint256 maxPerWallet;
        uint256[] amounts;
        uint32[] multBps;
        uint8 lockOptionId;
    }

    /// @param unit stake amount the rate is quoted for, e.g. 1e12 for $1M USDC or 500e18 for 500 stETH
    /// @param ratePerUnit reward tokens per `unit` per year at 1.00x
    /// @param cap max active principal in this sleeve
    struct SleeveConfig {
        address stakeToken;
        uint256 unit;
        uint256 ratePerUnit;
        uint256 cap;
        Tier[] tiers;
    }

    struct PoolConfig {
        address rewardToken;
        SleeveConfig[] sleeves;
        LockOption[] lockOptions;
        uint64 depositStart;
        uint64 depositEnd;
        uint64 epochLength;
        bool morBoost;
    }
}
