// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Subset of Morpheus Capital `DepositPool` (v7, MorpheusAIs/SmartContracts) that Morpheus DAT uses.
/// @dev `msg.sender` is always the depositor, so each CapitalAccount calls these functions itself.
interface IDepositPool {
    struct UserData {
        uint128 lastStake;
        uint256 deposited;
        uint256 rate;
        uint256 pendingRewards;
        uint128 claimLockStart;
        uint128 claimLockEnd;
        uint256 virtualDeposited;
        uint128 lastClaim;
        address referrer;
    }

    function version() external view returns (uint256);
    function depositToken() external view returns (address);
    function distributor() external view returns (address);

    function rewardPoolsProtocolDetails(uint256 rewardPoolIndex)
        external
        view
        returns (
            uint128 withdrawLockPeriodAfterStake,
            uint128 claimLockPeriodAfterStake,
            uint128 claimLockPeriodAfterClaim,
            uint256 minimalStake,
            uint256 distributedRewards
        );

    function usersData(address user, uint256 rewardPoolIndex)
        external
        view
        returns (
            uint128 lastStake,
            uint256 deposited,
            uint256 rate,
            uint256 pendingRewards,
            uint128 claimLockStart,
            uint128 claimLockEnd,
            uint256 virtualDeposited,
            uint128 lastClaim,
            address referrer
        );

    function stake(uint256 rewardPoolIndex, uint256 amount, uint128 claimLockEnd, address referrer) external;
    function withdraw(uint256 rewardPoolIndex, uint256 amount) external;
    function claim(uint256 rewardPoolIndex, address receiver) external payable;
    function lockClaim(uint256 rewardPoolIndex, uint128 claimLockEnd) external;
    function setClaimReceiver(uint256 rewardPoolIndex, address receiver) external;
    function getLatestUserReward(uint256 rewardPoolIndex, address user) external view returns (uint256);
}
