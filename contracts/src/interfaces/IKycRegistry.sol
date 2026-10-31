// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKycRegistry {
    function isAllowed(address account) external view returns (bool);
}
