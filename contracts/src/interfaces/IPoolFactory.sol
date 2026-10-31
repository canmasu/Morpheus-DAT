// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMorpheusAdapter} from "./IMorpheusAdapter.sol";

/// @notice What PoolVaults and CapitalAccounts read from the factory.
interface IPoolFactory {
    function adapter() external view returns (IMorpheusAdapter);
    function referralAddress() external view returns (address);
    function feeWallet() external view returns (address);
    function depositsPaused() external view returns (bool);
    function allPaused() external view returns (bool);
    function isGuardian(address account) external view returns (bool);
    function depositPoolOf(address stakeToken) external view returns (address);
}
