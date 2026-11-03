// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBuildersV4} from "../interfaces/IBuildersV4.sol";
import {PoolFactory} from "../ethereum/PoolFactory.sol";
import {BuilderVault} from "./BuilderVault.sol";

/// @title BuilderPoolFactory
/// @notice PoolFactory for Base: every pool is one MOR sleeve with its own new Morpheus Builders Subnet.
contract BuilderPoolFactory is PoolFactory {
    using SafeERC20 for IERC20;

    error UseCreateBuilderPool();
    error InvalidBuilderConfig();

    constructor(InitParams memory p) PoolFactory(p) {}

    function createPool(PoolConfig calldata, uint256) external pure override returns (address) {
        revert UseCreateBuilderPool();
    }

    /// @notice Permissionless. The caller becomes the Partner, funds `initialBudget` OG Tokens and pays any Morpheus
    /// Subnet creation fee in MOR (approve this factory for both). `subnetName` must be unused on Builders.
    function createBuilderPool(
        PoolConfig calldata cfg,
        uint256 initialBudget,
        string calldata subnetName,
        IBuildersV4.SubnetMetadata calldata metadata
    ) external nonReentrant returns (address vault) {
        // Builders has no claim lock to boost.
        if (cfg.morBoost || cfg.sleeves.length != 1) revert InvalidBuilderConfig();
        vault = _createPool(cfg, initialBudget);

        IBuildersV4 b = IBuildersV4(depositPoolOf[cfg.sleeves[0].stakeToken]);
        uint256 fee = b.subnetCreationFeeAmount();
        if (fee > 0) IERC20(cfg.sleeves[0].stakeToken).safeTransferFrom(msg.sender, vault, fee);
        BuilderVault(vault).setupSubnet(subnetName, metadata);
    }
}
