// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SendParam, MessagingFee} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Origin} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OFTMsgCodec} from "@layerzerolabs/oft-evm/contracts/libs/OFTMsgCodec.sol";
import {OGTokenAdapter} from "../src/OGTokenAdapter.sol";
import {OGTokenOFT} from "../src/OGTokenOFT.sol";
import {OGBridgeRegistry} from "../src/OGBridgeRegistry.sol";

contract Token is ERC20 {
    constructor() ERC20("Home", "HOME") {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract TaxedToken is Token {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value / 100);
            value -= value / 100;
        }
        super._update(from, to, value);
    }
}

/// @notice Runs on forks of BSC and Base against LayerZero's live endpoints and libraries. A message is delivered by
/// calling the OFT as the endpoint would, once the DVNs have verified it.
/// Skipped without BSC_RPC_URL and BASE_RPC_URL.
contract BridgeForkTest is Test {
    address constant EP_BSC = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant EP_BASE = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant EID_BSC = 30102;
    uint32 constant EID_BASE = 30184;
    bytes32 constant TERMS = keccak256("terms v1");

    address partner = makeAddr("partner");
    address farmer = makeAddr("farmer");
    uint256 bscFork;
    uint256 baseFork;
    bool skipped;

    Token token;
    OGTokenAdapter adapter;
    OGBridgeRegistry registry;
    OGTokenOFT oft;

    function setUp() public {
        string memory b = vm.envOr("BSC_RPC_URL", string(""));
        string memory c = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(b).length == 0 || bytes(c).length == 0) {
            skipped = true;
            return;
        }
        bscFork = vm.createFork(b);
        baseFork = vm.createFork(c);

        vm.selectFork(bscFork);
        vm.startPrank(partner);
        token = new Token();
        adapter = new OGTokenAdapter(address(token), EP_BSC, partner);
        vm.stopPrank();
        vm.deal(partner, 10 ether);

        vm.selectFork(baseFork);
        registry = new OGBridgeRegistry(EP_BASE);
        vm.prank(partner);
        oft = OGTokenOFT(registry.createOft("Home", "HOME", EID_BSC, address(token), address(adapter), TERMS));
        vm.deal(partner, 10 ether);
        vm.deal(farmer, 10 ether);
    }

    function _addr32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _options() internal pure returns (bytes memory) {
        return abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), uint128(200_000));
    }

    function _wirePeers() internal {
        vm.selectFork(bscFork);
        vm.prank(partner);
        adapter.setPeer(EID_BASE, _addr32(address(oft)));
        vm.selectFork(baseFork);
        vm.prank(partner);
        oft.setPeer(EID_BSC, _addr32(address(adapter)));
    }

    function _param(uint32 dst, address to, uint256 amount) internal pure returns (SendParam memory) {
        return SendParam(dst, _addr32(to), amount, amount, _options(), "", "");
    }

    function _deliverToBase(address to, uint64 amountSD, uint64 nonce) internal {
        vm.selectFork(baseFork);
        Origin memory o = Origin(EID_BSC, _addr32(address(adapter)), nonce);
        (bytes memory m,) = OFTMsgCodec.encode(_addr32(to), amountSD, "");
        vm.prank(EP_BASE);
        oft.lzReceive(o, keccak256("guid"), m, address(0), "");
    }

    function test_registryRecordsPartnerAndTerms() public {
        if (skipped) return;
        vm.selectFork(baseFork);
        (address p, uint32 eid, address home, address ad, bytes32 terms) = registry.bridges(address(oft));
        assertEq(p, partner);
        assertEq(eid, EID_BSC);
        assertEq(home, address(token));
        assertEq(ad, address(adapter));
        assertEq(terms, TERMS);
        assertEq(oft.owner(), partner);
        assertEq(oft.totalSupply(), 0);
    }

    function test_createOftNeedsTerms() public {
        if (skipped) return;
        vm.selectFork(baseFork);
        vm.expectRevert(OGBridgeRegistry.TermsRequired.selector);
        registry.createOft("x", "x", EID_BSC, address(token), address(adapter), bytes32(0));
    }

    function test_roundTripLocksThenMintsThenBurnsThenUnlocks() public {
        if (skipped) return;
        _wirePeers();
        uint256 amount = 1_000e18;

        // BSC to Base: tokens lock in the adapter.
        vm.selectFork(bscFork);
        vm.startPrank(partner);
        token.approve(address(adapter), amount);
        SendParam memory p = _param(EID_BASE, partner, amount);
        MessagingFee memory fee = adapter.quoteSend(p, false);
        console2.log("LayerZero fee, BSC to Base, wei", fee.nativeFee);
        adapter.send{value: fee.nativeFee}(p, fee, partner);
        vm.stopPrank();
        assertEq(token.balanceOf(address(adapter)), amount);

        // Base: the same amount is minted.
        _deliverToBase(partner, uint64(amount / 1e12), 1);
        assertEq(oft.balanceOf(partner), amount);
        assertEq(oft.totalSupply(), amount);

        // A Farmer who received OG Tokens goes back: they burn on Base.
        vm.prank(partner);
        oft.transfer(farmer, 100e18);
        vm.startPrank(farmer);
        SendParam memory back = _param(EID_BSC, farmer, 100e18);
        MessagingFee memory backFee = oft.quoteSend(back, false);
        console2.log("LayerZero fee, Base to BSC, wei", backFee.nativeFee);
        oft.send{value: backFee.nativeFee}(back, backFee, farmer);
        vm.stopPrank();
        assertEq(oft.totalSupply(), amount - 100e18);

        // BSC: unlocked to the Farmer.
        vm.selectFork(bscFork);
        Origin memory o = Origin(EID_BASE, _addr32(address(oft)), 1);
        (bytes memory m,) = OFTMsgCodec.encode(_addr32(farmer), uint64(100e18 / 1e12), "");
        vm.prank(EP_BSC);
        adapter.lzReceive(o, keccak256("guid2"), m, address(0), "");
        assertEq(token.balanceOf(farmer), 100e18);
        assertEq(token.balanceOf(address(adapter)), amount - 100e18);
    }

    function test_taxedTokenIsRejected() public {
        if (skipped) return;
        vm.selectFork(bscFork);
        vm.startPrank(partner);
        TaxedToken taxed = new TaxedToken();
        OGTokenAdapter a = new OGTokenAdapter(address(taxed), EP_BSC, partner);
        a.setPeer(EID_BASE, _addr32(address(oft)));
        taxed.approve(address(a), 1_000e18);
        SendParam memory p = _param(EID_BASE, partner, 1_000e18);
        MessagingFee memory fee = a.quoteSend(p, false);
        vm.expectRevert(abi.encodeWithSelector(OGTokenAdapter.TransferTaxNotSupported.selector, 1_000e18, 990e18));
        a.send{value: fee.nativeFee}(p, fee, partner);
        vm.stopPrank();
    }

    function test_checkTokenPassesPlainAndCatchesTaxed() public {
        if (skipped) return;
        vm.selectFork(bscFork);
        vm.startPrank(partner);
        token.approve(address(adapter), 1e18);
        adapter.checkToken(1e18);
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(partner), 1_000_000e18);

        TaxedToken taxed = new TaxedToken();
        OGTokenAdapter a = new OGTokenAdapter(address(taxed), EP_BSC, partner);
        taxed.approve(address(a), 1e18);
        vm.expectRevert(abi.encodeWithSelector(OGTokenAdapter.TransferTaxNotSupported.selector, 1e18, 0.99e18));
        a.checkToken(1e18);
        vm.stopPrank();
    }

    function test_onlyThePeerCanMint() public {
        if (skipped) return;
        _wirePeers();
        vm.selectFork(baseFork);
        Origin memory o = Origin(EID_BSC, _addr32(makeAddr("attacker")), 1);
        (bytes memory m,) = OFTMsgCodec.encode(_addr32(farmer), 1e6, "");
        vm.prank(EP_BASE);
        vm.expectRevert();
        oft.lzReceive(o, keccak256("g"), m, address(0), "");
        assertEq(oft.totalSupply(), 0);
    }

    function test_onlyOwnerCanChangeBridge() public {
        if (skipped) return;
        vm.selectFork(baseFork);
        vm.prank(farmer);
        vm.expectRevert();
        oft.setPeer(EID_BSC, _addr32(farmer));
    }
}
