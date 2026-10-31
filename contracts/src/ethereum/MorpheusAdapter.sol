// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IDepositPool} from "../interfaces/IDepositPool.sol";
import {IMorpheusAdapter} from "../interfaces/IMorpheusAdapter.sol";

/// @title MorpheusAdapter
/// @notice Encodes calls for Morpheus Capital v7 DepositPools and holds the circuit-breaker baseline.
/// @dev Replaceable through PoolFactory (48h timelock). It never holds funds and never calls Morpheus itself.
contract MorpheusAdapter is IMorpheusAdapter, Ownable2Step {
    struct Baseline {
        bool registered;
        uint256 poolIndex;
        uint256 version;
        address distributor;
        uint128 withdrawLockPeriodAfterStake;
        uint128 claimLockPeriodAfterStake;
        uint128 claimLockPeriodAfterClaim;
        uint256 minimalStake;
    }

    mapping(address depositPool => Baseline) public baselines;

    event BaselineRecorded(address indexed depositPool, uint256 poolIndex, uint256 version);

    error UnknownDepositPool(address depositPool);

    constructor(address owner_, address[] memory depositPools, uint256[] memory poolIndexes) Ownable(owner_) {
        for (uint256 i; i < depositPools.length; ++i) {
            _record(depositPools[i], poolIndexes[i]);
        }
    }

    /// @notice Re-reads live Morpheus settings as the new baseline. Called by the multisig after a fork test
    /// shows a Morpheus change is safe; until then `isHealthy` stays false and new stakes are blocked.
    function recordBaseline(address depositPool, uint256 poolIndex) external onlyOwner {
        _record(depositPool, poolIndex);
    }

    function isExitOnly() public view virtual returns (bool) {
        return false;
    }

    function isHealthy(address depositPool) public view virtual returns (bool) {
        Baseline memory b = baselines[depositPool];
        if (!b.registered) return false;
        try this.liveBaseline(depositPool, b.poolIndex) returns (Baseline memory live) {
            return live.version == b.version && live.distributor == b.distributor
                && live.withdrawLockPeriodAfterStake == b.withdrawLockPeriodAfterStake
                && live.claimLockPeriodAfterStake == b.claimLockPeriodAfterStake
                && live.claimLockPeriodAfterClaim == b.claimLockPeriodAfterClaim && live.minimalStake == b.minimalStake;
        } catch {
            return false;
        }
    }

    /// @notice Live Morpheus settings in Baseline form. External so `isHealthy` can wrap it in try/catch.
    function liveBaseline(address depositPool, uint256 poolIndex) external view returns (Baseline memory) {
        return _liveBaseline(depositPool, poolIndex);
    }

    function _liveBaseline(address depositPool, uint256 poolIndex) internal view returns (Baseline memory b) {
        IDepositPool dp = IDepositPool(depositPool);
        (b.withdrawLockPeriodAfterStake, b.claimLockPeriodAfterStake, b.claimLockPeriodAfterClaim, b.minimalStake,) =
            dp.rewardPoolsProtocolDetails(poolIndex);
        b.registered = true;
        b.poolIndex = poolIndex;
        b.version = dp.version();
        b.distributor = dp.distributor();
    }

    function encodeStake(address depositPool, uint256 amount, uint128 claimLockEnd, address referrer)
        external
        view
        virtual
        returns (address spender, bytes memory data)
    {
        spender = IDepositPool(depositPool).distributor();
        data = abi.encodeCall(IDepositPool.stake, (_index(depositPool), amount, claimLockEnd, referrer));
    }

    /// @dev Morpheus caps `amount` at the depositor's balance, so max withdraws everything.
    function encodeWithdrawAll(address depositPool) external view virtual returns (bytes memory) {
        return abi.encodeCall(IDepositPool.withdraw, (_index(depositPool), type(uint256).max));
    }

    function encodeClaim(address depositPool, address receiver) external view virtual returns (bytes memory) {
        return abi.encodeCall(IDepositPool.claim, (_index(depositPool), receiver));
    }

    function encodeLockClaim(address depositPool, uint128 claimLockEnd) external view virtual returns (bytes memory) {
        return abi.encodeCall(IDepositPool.lockClaim, (_index(depositPool), claimLockEnd));
    }

    function encodeSetClaimReceiver(address depositPool, address receiver)
        external
        view
        virtual
        returns (bytes memory)
    {
        return abi.encodeCall(IDepositPool.setClaimReceiver, (_index(depositPool), receiver));
    }

    function deposited(address depositPool, address account) external view returns (uint256 amount) {
        (, amount,,,,,,,) = IDepositPool(depositPool).usersData(account, _index(depositPool));
    }

    function pendingMor(address depositPool, address account) external view returns (uint256) {
        return IDepositPool(depositPool).getLatestUserReward(_index(depositPool), account);
    }

    function _index(address depositPool) internal view returns (uint256) {
        Baseline storage b = baselines[depositPool];
        if (!b.registered) revert UnknownDepositPool(depositPool);
        return b.poolIndex;
    }

    function _record(address depositPool, uint256 poolIndex) internal {
        baselines[depositPool] = _liveBaseline(depositPool, poolIndex);
        emit BaselineRecorded(depositPool, poolIndex, baselines[depositPool].version);
    }
}
