// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Local sandbox only. Its runtime code replaces Morpheus's ChainLinkDataConsumer on a mainnet fork
/// (anvil_setCode), so prices never go stale when the sandbox skips months ahead.
contract SandboxPriceConsumer {
    bytes32 internal constant SLOT = keccak256("dat.sandbox.prices");

    function getPathId(string memory path) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(path));
    }

    function decimals() public pure returns (uint8) {
        return 18;
    }

    function getChainLinkDataFeedLatestAnswer(bytes32 pathId) external view returns (uint256 price) {
        bytes32 slot = keccak256(abi.encode(pathId, SLOT));
        assembly {
            price := sload(slot)
        }
    }

    function setPrice(bytes32 pathId, uint256 price) external {
        bytes32 slot = keccak256(abi.encode(pathId, SLOT));
        assembly {
            sstore(slot, price)
        }
    }
}
