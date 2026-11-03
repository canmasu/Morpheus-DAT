// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IBuildersV4} from "../interfaces/IBuildersV4.sol";
import {IMorpheusAdapter} from "../interfaces/IMorpheusAdapter.sol";
import {CapitalAccount} from "../ethereum/CapitalAccount.sol";
import {BuilderVault} from "./BuilderVault.sol";

/// @title BuildersAdapter
/// @notice Encodes calls for Morpheus BuildersV4 and holds the circuit-breaker baseline.
/// @dev The "depositPool" here is the Builders contract. It is shared by every pool, so the Subnet comes from the
/// calling CapitalAccount's vault. MOR claims and claim locks do not exist per account: see BuilderVault.
contract BuildersAdapter is IMorpheusAdapter, Ownable2Step {
    struct Baseline {
        bool registered;
        uint256 version;
        address depositToken;
        address rewardPool;
        uint256 minimalWithdrawLockPeriod;
    }

    mapping(address builders => Baseline) public baselines;

    event BaselineRecorded(address indexed builders, uint256 version);

    error NotSupported();

    constructor(address owner_, address[] memory builders) Ownable(owner_) {
        for (uint256 i; i < builders.length; ++i) {
            _record(builders[i]);
        }
    }

    /// @notice Re-reads live Morpheus settings as the new baseline, after a fork test shows a change is safe.
    function recordBaseline(address builders) external onlyOwner {
        _record(builders);
    }

    function isExitOnly() public view virtual returns (bool) {
        return false;
    }

    function isHealthy(address builders) public view virtual returns (bool) {
        Baseline memory b = baselines[builders];
        if (!b.registered) return false;
        try this.liveBaseline(builders) returns (Baseline memory live) {
            return live.version == b.version && live.depositToken == b.depositToken && live.rewardPool == b.rewardPool
                && live.minimalWithdrawLockPeriod == b.minimalWithdrawLockPeriod;
        } catch {
            return false;
        }
    }

    /// @notice Live Morpheus settings in Baseline form. External so `isHealthy` can wrap it in try/catch.
    function liveBaseline(address builders) external view returns (Baseline memory) {
        return _liveBaseline(builders);
    }

    function encodeStake(address builders, uint256 amount, uint128, address)
        external
        view
        virtual
        returns (address spender, bytes memory data)
    {
        spender = builders;
        data = abi.encodeCall(IBuildersV4.deposit, (_subnetOf(msg.sender), amount));
    }

    /// @dev Builders caps `amount` at the depositor's balance, so max withdraws everything.
    function encodeWithdrawAll(address) external view virtual returns (bytes memory) {
        return abi.encodeCall(IBuildersV4.withdraw, (_subnetOf(msg.sender), type(uint256).max));
    }

    function encodeClaim(address, address) external pure virtual returns (bytes memory) {
        revert NotSupported();
    }

    function encodeLockClaim(address, uint128) external pure virtual returns (bytes memory) {
        revert NotSupported();
    }

    function encodeSetClaimReceiver(address, address) external pure virtual returns (bytes memory) {
        revert NotSupported();
    }

    function deposited(address builders, address account) external view returns (uint256 amount) {
        (,, amount,) = IBuildersV4(builders).usersData(account, _subnetOf(account));
    }

    /// @notice MOR earned by the account's whole Subnet.
    function pendingMor(address builders, address account) external view returns (uint256) {
        return IBuildersV4(builders).getCurrentSubnetRewards(_subnetOf(account));
    }

    function _subnetOf(address account) internal view returns (bytes32) {
        return BuilderVault(CapitalAccount(payable(account)).vault()).subnetId();
    }

    function _liveBaseline(address builders) internal view returns (Baseline memory b) {
        IBuildersV4 dp = IBuildersV4(builders);
        b.registered = true;
        b.version = dp.version();
        b.depositToken = dp.depositToken();
        b.rewardPool = dp.rewardPool();
        b.minimalWithdrawLockPeriod = dp.minimalWithdrawLockPeriod();
    }

    function _record(address builders) internal {
        baselines[builders] = _liveBaseline(builders);
        emit BaselineRecorded(builders, baselines[builders].version);
    }
}
