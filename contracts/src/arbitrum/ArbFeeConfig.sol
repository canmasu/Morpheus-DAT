// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ArbFeeConfig
/// @notice DAT fee settings every MorSplitter reads. Same cap and timelock as PoolFactory on Ethereum.
contract ArbFeeConfig is Ownable2Step {
    uint16 public constant FEE_CAP_BPS = 2000;
    uint256 public constant TIMELOCK = 48 hours;

    address public immutable mor;
    uint16 public feeBps;
    uint16 public pendingFeeBps;
    uint256 public pendingFeeEta;
    address public feeWallet;

    event FeeQueued(uint16 bps, uint256 eta);
    event FeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeWalletUpdated(address wallet);

    error FeeTooHigh();
    error TimelockActive();
    error NothingQueued();
    error ZeroAddress();

    constructor(address owner_, address mor_, uint16 feeBps_, address feeWallet_) Ownable(owner_) {
        if (mor_ == address(0) || feeWallet_ == address(0)) revert ZeroAddress();
        if (feeBps_ > FEE_CAP_BPS) revert FeeTooHigh();
        mor = mor_;
        feeBps = feeBps_;
        feeWallet = feeWallet_;
    }

    function queueFee(uint16 bps) external onlyOwner {
        if (bps > FEE_CAP_BPS) revert FeeTooHigh();
        pendingFeeBps = bps;
        pendingFeeEta = block.timestamp + TIMELOCK;
        emit FeeQueued(bps, pendingFeeEta);
    }

    function applyFee() external {
        if (pendingFeeEta == 0) revert NothingQueued();
        if (block.timestamp < pendingFeeEta) revert TimelockActive();
        emit FeeUpdated(feeBps, pendingFeeBps);
        feeBps = pendingFeeBps;
        pendingFeeEta = 0;
    }

    function setFeeWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        feeWallet = wallet;
        emit FeeWalletUpdated(wallet);
    }
}
