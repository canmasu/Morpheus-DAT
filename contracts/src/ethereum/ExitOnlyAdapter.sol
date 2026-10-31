// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MorpheusAdapter} from "./MorpheusAdapter.sol";

/// @title ExitOnlyAdapter
/// @notice Pre-audited fallback the multisig can switch to instantly: withdrawals only.
/// Stakes, MOR claims and claim locks all revert, and `isHealthy` is always false.
contract ExitOnlyAdapter is MorpheusAdapter {
    error ExitOnly();

    constructor(address owner_, address[] memory depositPools, uint256[] memory poolIndexes)
        MorpheusAdapter(owner_, depositPools, poolIndexes)
    {}

    function isExitOnly() public pure override returns (bool) {
        return true;
    }

    function isHealthy(address) public pure override returns (bool) {
        return false;
    }

    function encodeStake(address, uint256, uint128, address) external pure override returns (address, bytes memory) {
        revert ExitOnly();
    }

    function encodeClaim(address, address) external pure override returns (bytes memory) {
        revert ExitOnly();
    }

    function encodeLockClaim(address, uint128) external pure override returns (bytes memory) {
        revert ExitOnly();
    }

    function encodeSetClaimReceiver(address, address) external pure override returns (bytes memory) {
        revert ExitOnly();
    }
}
