// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ArbFeeConfig} from "./ArbFeeConfig.sol";

/// @title MorSplitter
/// @notice Receives a pool's MOR on Arbitrum and splits it: DAT fee to the fee wallet, the rest to the Partner.
contract MorSplitter is Initializable {
    using SafeERC20 for IERC20;

    address public partner;
    ArbFeeConfig public feeConfig;

    event MorDistributed(uint256 total, uint256 fee, uint256 partnerAmount, uint16 feeBps);

    constructor() {
        _disableInitializers();
    }

    function initialize(address partner_, address feeConfig_) external initializer {
        partner = partner_;
        feeConfig = ArbFeeConfig(feeConfig_);
    }

    /// @notice Anyone can split the current MOR balance.
    function distribute() external returns (uint256 total) {
        IERC20 mor = IERC20(feeConfig.mor());
        total = mor.balanceOf(address(this));
        if (total == 0) return 0;
        uint16 bps = feeConfig.feeBps();
        uint256 fee = total * bps / 10_000;
        if (fee > 0) mor.safeTransfer(feeConfig.feeWallet(), fee);
        mor.safeTransfer(partner, total - fee);
        emit MorDistributed(total, fee, total - fee, bps);
    }
}
