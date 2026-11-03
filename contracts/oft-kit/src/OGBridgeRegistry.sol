// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {OGTokenOFT} from "./OGTokenOFT.sol";

/// @title OGBridgeRegistry
/// @notice On Base. Deploys a Partner's OFT, with the Partner as its only owner, and keeps a public record of the terms
/// the Partner accepted. It has no admin and no power over any bridge.
/// @dev Entries are the Partner's own claims. Anyone can register, so the site reads the bridge's live settings before
/// showing it as checked.
contract OGBridgeRegistry {
    struct Bridge {
        address partner;
        uint32 homeEid;
        address homeToken;
        address adapter;
        bytes32 termsHash;
    }

    address public immutable endpoint;

    mapping(address oft => Bridge) public bridges;
    address[] public ofts;

    event BridgeCreated(address indexed oft, address indexed partner, uint32 homeEid, address homeToken, address adapter);
    event TermsAccepted(address indexed partner, address indexed oft, bytes32 termsHash);

    error TermsRequired();

    constructor(address endpoint_) {
        endpoint = endpoint_;
    }

    /// @param termsHash keccak256 of the terms text the Partner agreed to, in the wallet that signs this transaction
    function createOft(
        string calldata name,
        string calldata symbol,
        uint32 homeEid,
        address homeToken,
        address adapter,
        bytes32 termsHash
    ) external returns (address oft) {
        if (termsHash == bytes32(0)) revert TermsRequired();
        oft = address(new OGTokenOFT(name, symbol, endpoint, msg.sender));
        bridges[oft] = Bridge(msg.sender, homeEid, homeToken, adapter, termsHash);
        ofts.push(oft);
        emit BridgeCreated(oft, msg.sender, homeEid, homeToken, adapter);
        emit TermsAccepted(msg.sender, oft, termsHash);
    }

    function count() external view returns (uint256) {
        return ofts.length;
    }
}
