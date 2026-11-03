// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";

/// @title OGTokenAdapter
/// @notice LayerZero's OFTAdapter for a token on its home chain: locks tokens here, the OFT on Base mints them.
/// @dev The only change: a token that takes a fee on transfer reverts, because the bridge would otherwise mint more
/// on Base than it locked here.
contract OGTokenAdapter is OFTAdapter {
    using SafeERC20 for *;

    error TransferTaxNotSupported(uint256 sent, uint256 received);

    constructor(address token_, address endpoint, address owner_) OFTAdapter(token_, endpoint, owner_) Ownable(owner_) {}

    /// @notice Run as a simulation before the rest of setup: pulls `amount` from the caller and returns it, reverting if
    /// the token takes a fee either way. Needs an allowance. Anyone may call it; it can hold nothing back.
    function checkToken(uint256 amount) external {
        uint256 before = innerToken.balanceOf(address(this));
        uint256 callerBefore = innerToken.balanceOf(msg.sender);
        innerToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = innerToken.balanceOf(address(this)) - before;
        if (received != amount) revert TransferTaxNotSupported(amount, received);
        innerToken.safeTransfer(msg.sender, amount);
        uint256 returned = innerToken.balanceOf(msg.sender);
        if (returned != callerBefore) revert TransferTaxNotSupported(callerBefore, returned);
    }

    function _debit(address from, uint256 amountLD, uint256 minAmountLD, uint32 dstEid)
        internal
        override
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        (amountSentLD, amountReceivedLD) = _debitView(amountLD, minAmountLD, dstEid);
        uint256 before = innerToken.balanceOf(address(this));
        innerToken.safeTransferFrom(from, address(this), amountSentLD);
        uint256 received = innerToken.balanceOf(address(this)) - before;
        if (received != amountSentLD) revert TransferTaxNotSupported(amountSentLD, received);
    }
}
