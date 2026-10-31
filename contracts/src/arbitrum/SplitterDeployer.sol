// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MorSplitter} from "./MorSplitter.sol";

/// @title SplitterDeployer
/// @notice Deploys each pool's MorSplitter at the address PoolFactory predicted on Ethereum.
/// @dev The salt commits to the partner, so a third party deploying first can only create the correct splitter.
contract SplitterDeployer {
    address public immutable splitterImpl;
    address public immutable feeConfig;

    event SplitterDeployed(bytes32 indexed poolSalt, address indexed partner, address splitter);

    constructor(address splitterImpl_, address feeConfig_) {
        splitterImpl = splitterImpl_;
        feeConfig = feeConfig_;
    }

    /// @param poolSalt `PoolFactory.poolSalt(vault)` on Ethereum
    function deploySplitter(bytes32 poolSalt, address partner) external returns (address splitter) {
        splitter = Clones.cloneDeterministic(splitterImpl, _salt(poolSalt, partner));
        MorSplitter(splitter).initialize(partner, feeConfig);
        emit SplitterDeployed(poolSalt, partner, splitter);
    }

    function predict(bytes32 poolSalt, address partner) external view returns (address) {
        return Clones.predictDeterministicAddress(splitterImpl, _salt(poolSalt, partner));
    }

    function _salt(bytes32 poolSalt, address partner) internal pure returns (bytes32) {
        return keccak256(abi.encode(poolSalt, partner));
    }
}
