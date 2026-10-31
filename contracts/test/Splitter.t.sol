// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {PoolVault} from "../src/ethereum/PoolVault.sol";
import {MorSplitter} from "../src/arbitrum/MorSplitter.sol";
import {ArbFeeConfig} from "../src/arbitrum/ArbFeeConfig.sol";

contract SplitterTest is Base {
    function test_predictedAddressMatchesDeployment() public {
        PoolVault vault = createExamplePool(false);
        bytes32 salt = factory.poolSalt(address(vault));
        assertEq(splitterDeployer.predict(salt, partner), vault.morReceiver());
        address deployed = splitterDeployer.deploySplitter(salt, partner);
        assertEq(deployed, vault.morReceiver());
        assertEq(MorSplitter(deployed).partner(), partner);
    }

    function test_wrongPartnerCannotTakeTheAddress() public {
        PoolVault vault = createExamplePool(false);
        bytes32 salt = factory.poolSalt(address(vault));
        address squatted = splitterDeployer.deploySplitter(salt, alice);
        assertTrue(squatted != vault.morReceiver());
        assertEq(splitterDeployer.deploySplitter(salt, partner), vault.morReceiver());
    }

    function test_distributeSplits90_10() public {
        PoolVault vault = createExamplePool(false);
        MorSplitter s = MorSplitter(splitterDeployer.deploySplitter(factory.poolSalt(address(vault)), partner));
        mor.mint(address(s), 100e18);
        vm.prank(bob);
        s.distribute();
        assertEq(mor.balanceOf(feeWallet), 10e18);
        assertEq(mor.balanceOf(partner), 90e18);
    }

    function test_feeCapAndTimelock() public {
        vm.startPrank(admin);
        vm.expectRevert(ArbFeeConfig.FeeTooHigh.selector);
        feeConfig.queueFee(2001);
        feeConfig.queueFee(2000);
        vm.stopPrank();
        vm.expectRevert(ArbFeeConfig.TimelockActive.selector);
        feeConfig.applyFee();
        vm.warp(block.timestamp + 48 hours);
        feeConfig.applyFee();
        assertEq(feeConfig.feeBps(), 2000);
    }
}
