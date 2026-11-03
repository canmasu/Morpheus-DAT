// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BuildersAdapter} from "./BuildersAdapter.sol";

/// @title BuildersExitAdapter
/// @notice Pre-audited fallback the multisig can switch to instantly: withdrawals only.
contract BuildersExitAdapter is BuildersAdapter {
    error ExitOnly();

    constructor(address owner_, address[] memory builders) BuildersAdapter(owner_, builders) {}

    function isExitOnly() public pure override returns (bool) {
        return true;
    }

    function isHealthy(address) public pure override returns (bool) {
        return false;
    }

    function encodeStake(address, uint256, uint128, address) external pure override returns (address, bytes memory) {
        revert ExitOnly();
    }
}
