// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OTCMarket} from "../src/ethereum/OTCMarket.sol";
import {IKycRegistry} from "../src/interfaces/IKycRegistry.sol";
import {MockERC20, FeeOnTransferToken, MockKycRegistry} from "./mocks/Mocks.sol";

contract OTCMarketTest is Test {
    OTCMarket otc;
    MockERC20 wbtc; // 8 decimals
    MockERC20 usdc; // 6 decimals
    MockERC20 exampleToken; // 18 decimals
    address maker = makeAddr("maker");
    address taker = makeAddr("taker");

    function setUp() public {
        otc = new OTCMarket();
        wbtc = new MockERC20("WBTC", "WBTC", 8);
        usdc = new MockERC20("USDC", "USDC", 6);
        exampleToken = new MockERC20("EXM", "EXM", 18);
        usdc.mint(taker, 1_000_000e6);
        vm.prank(taker);
        usdc.approve(address(otc), type(uint256).max);
    }

    function _list(uint256 amountX, uint256 totalY, uint256 minFill, uint64 expiry, address priv, address reg)
        internal
        returns (uint256 id)
    {
        wbtc.mint(maker, amountX);
        vm.startPrank(maker);
        wbtc.approve(address(otc), amountX);
        id = otc.createListing(wbtc, amountX, usdc, totalY, minFill, expiry, priv, IKycRegistry(reg));
        vm.stopPrank();
    }

    function test_partialFillsAndCeilRounding() public {
        // 3 WBTC for 200,000 USDC
        uint256 id = _list(3e8, 200_000e6, 0, 0, address(0), address(0));
        vm.prank(taker);
        uint256 paidY = otc.fill(id, 1e8, type(uint256).max);
        assertEq(paidY, 66_666_666_667, "rounded up for the maker");
        assertEq(wbtc.balanceOf(taker), 1e8);
        assertEq(usdc.balanceOf(maker), paidY);
        vm.prank(taker);
        otc.fill(id, 2e8, type(uint256).max);
        assertEq(uint8(otc.listing(id).status), uint8(OTCMarket.Status.Filled));
    }

    function test_maxYProtectsTaker() public {
        uint256 id = _list(1e8, 70_000e6, 0, 0, address(0), address(0));
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(OTCMarket.SlippageExceeded.selector, 70_000e6, 69_999e6));
        otc.fill(id, 1e8, 69_999e6);
    }

    function test_minFillExceptLastPiece() public {
        uint256 id = _list(1e8, 70_000e6, 0.4e8, 0, address(0), address(0));
        vm.startPrank(taker);
        vm.expectRevert(OTCMarket.BadFillAmount.selector);
        otc.fill(id, 0.1e8, type(uint256).max);
        otc.fill(id, 0.7e8, type(uint256).max);
        otc.fill(id, 0.3e8, type(uint256).max); // remainder below minFill is allowed
        vm.stopPrank();
    }

    function test_cancelReturnsUnfilled() public {
        uint256 id = _list(1e8, 70_000e6, 0, 0, address(0), address(0));
        vm.prank(taker);
        otc.fill(id, 0.25e8, type(uint256).max);
        vm.prank(taker);
        vm.expectRevert(OTCMarket.NotMaker.selector);
        otc.cancel(id);
        vm.prank(maker);
        otc.cancel(id);
        assertEq(wbtc.balanceOf(maker), 0.75e8);
    }

    function test_expiry() public {
        uint256 id = _list(1e8, 70_000e6, 0, uint64(block.timestamp + 30 days), address(0), address(0));
        vm.expectRevert(OTCMarket.NotExpired.selector);
        otc.reclaimExpired(id);
        vm.warp(block.timestamp + 30 days);
        vm.prank(taker);
        vm.expectRevert(OTCMarket.ListingExpired.selector);
        otc.fill(id, 1e8, type(uint256).max);
        otc.reclaimExpired(id);
        assertEq(wbtc.balanceOf(maker), 1e8);
    }

    function test_privateTakerAndKyc() public {
        MockKycRegistry reg = new MockKycRegistry();
        uint256 a = _list(1e8, 70_000e6, 0, 0, makeAddr("vip"), address(0));
        uint256 b = _list(1e8, 70_000e6, 0, 0, address(0), address(reg));
        vm.startPrank(taker);
        vm.expectRevert(OTCMarket.TakerNotAllowed.selector);
        otc.fill(a, 1e8, type(uint256).max);
        vm.expectRevert(OTCMarket.TakerNotAllowed.selector);
        otc.fill(b, 1e8, type(uint256).max);
        vm.stopPrank();
        reg.set(taker, true);
        vm.prank(taker);
        otc.fill(b, 1e8, type(uint256).max);
    }

    function test_feeOnTransferRecordsWhatArrived() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        fot.mint(maker, 100e18);
        vm.startPrank(maker);
        fot.approve(address(otc), 100e18);
        uint256 id = otc.createListing(fot, 100e18, usdc, 1_000e6, 0, 0, address(0), IKycRegistry(address(0)));
        vm.stopPrank();
        assertEq(otc.listing(id).totalX, 99e18);
    }

    function testFuzz_fillNeverUnderpaysMaker(uint64 x, uint64 y, uint64 part) public {
        uint256 totalX = bound(x, 1, 1e18);
        uint256 totalY = bound(y, 1, 1e12);
        uint256 amountX = bound(part, 1, totalX);
        uint256 id = _list(totalX, totalY, 0, 0, address(0), address(0));
        vm.prank(taker);
        uint256 paidY = otc.fill(id, amountX, type(uint256).max);
        assertGe(paidY * totalX, amountX * totalY);
    }
}
