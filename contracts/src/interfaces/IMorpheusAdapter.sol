// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Translates DAT actions into Morpheus calls. CapitalAccounts execute the returned calldata
/// against their own (fixed) DepositPool, so swapping the adapter can change *how* Morpheus is called,
/// never *where* principal goes.
interface IMorpheusAdapter {
    function isExitOnly() external view returns (bool);

    /// @notice False when the DepositPool no longer matches its recorded baseline (circuit breaker).
    function isHealthy(address depositPool) external view returns (bool);

    function encodeStake(address depositPool, uint256 amount, uint128 claimLockEnd, address referrer)
        external
        view
        returns (address spender, bytes memory data);
    function encodeWithdrawAll(address depositPool) external view returns (bytes memory data);
    function encodeClaim(address depositPool, address receiver) external view returns (bytes memory data);
    function encodeLockClaim(address depositPool, uint128 claimLockEnd) external view returns (bytes memory data);
    function encodeSetClaimReceiver(address depositPool, address receiver) external view returns (bytes memory data);

    function deposited(address depositPool, address account) external view returns (uint256);
    function pendingMor(address depositPool, address account) external view returns (uint256);
}
