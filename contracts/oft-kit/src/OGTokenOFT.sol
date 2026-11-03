// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

/// @title OGTokenOFT
/// @notice LayerZero's OFT, unchanged: the Base side of a Partner's token. Supply exists only through the bridge.
contract OGTokenOFT is OFT {
    constructor(string memory name_, string memory symbol_, address endpoint, address owner_)
        OFT(name_, symbol_, endpoint, owner_)
        Ownable(owner_)
    {}
}
