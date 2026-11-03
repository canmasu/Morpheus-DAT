// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolTypes} from "../../src/interfaces/IPoolTypes.sol";
import {IBuildersV4} from "../../src/interfaces/IBuildersV4.sol";
import {PoolFactory} from "../../src/ethereum/PoolFactory.sol";
import {CapitalAccount} from "../../src/ethereum/CapitalAccount.sol";
import {BuilderPoolFactory} from "../../src/base/BuilderPoolFactory.sol";
import {BuilderVault} from "../../src/base/BuilderVault.sol";
import {BuildersAdapter} from "../../src/base/BuildersAdapter.sol";
import {BuildersExitAdapter} from "../../src/base/BuildersExitAdapter.sol";
import {MorSplitter} from "../../src/arbitrum/MorSplitter.sol";
import {SplitterDeployer} from "../../src/arbitrum/SplitterDeployer.sol";
import {ArbFeeConfig} from "../../src/arbitrum/ArbFeeConfig.sol";
import {MockERC20} from "../mocks/Mocks.sol";

/// @notice Runs DAT against live Morpheus BuildersV4 on a Base mainnet fork.
/// `BASE_RPC_URL=https://mainnet.base.org forge test --match-path test/fork/BuildersFork.t.sol -vv`.
/// Skipped without BASE_RPC_URL.
contract BuildersForkTest is Test, IPoolTypes {
    IBuildersV4 constant BUILDERS = IBuildersV4(0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9);
    IERC20 constant MOR = IERC20(0x7431aDa8a591C955a994a21710752EF9b882b8e3);

    address partner = makeAddr("partner");
    address alice = makeAddr("alice");
    address feeWallet = makeAddr("feeWallet");
    MockERC20 og;
    BuilderPoolFactory factory;
    SplitterDeployer splitterDeployer;
    BuilderVault vault;
    bool skipped;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            skipped = true;
            return;
        }
        vm.createSelectFork(rpc);

        og = new MockERC20("OG", "OG", 18);
        ArbFeeConfig feeConfig = new ArbFeeConfig(address(this), address(MOR), 1000, feeWallet);
        MorSplitter splitterImpl = new MorSplitter();
        splitterDeployer = new SplitterDeployer(address(splitterImpl), address(feeConfig));
        address[] memory list = new address[](1);
        list[0] = address(BUILDERS);
        address[] memory tokens = new address[](1);
        tokens[0] = address(MOR);
        factory = new BuilderPoolFactory(
            PoolFactory.InitParams({
                admin: address(this),
                poolVaultImpl: address(new BuilderVault()),
                capitalAccountImpl: address(new CapitalAccount()),
                adapter: address(new BuildersAdapter(address(this), list)),
                exitAdapter: address(new BuildersExitAdapter(address(this), list)),
                splitterDeployer: address(splitterDeployer),
                splitterImpl: address(splitterImpl),
                feeWallet: feeWallet,
                referralAddress: address(0),
                feeBps: 1000,
                stakeTokens: tokens,
                depositPools: list
            })
        );

        PoolConfig memory cfg;
        cfg.rewardToken = address(og);
        cfg.depositStart = uint64(block.timestamp);
        cfg.depositEnd = uint64(block.timestamp + 90 days);
        cfg.epochLength = 30 days;
        cfg.lockOptions = new LockOption[](1);
        cfg.lockOptions[0] = LockOption(365 days, 10_000);
        cfg.sleeves = new SleeveConfig[](1);
        cfg.sleeves[0].stakeToken = address(MOR);
        cfg.sleeves[0].unit = 1_000e18;
        cfg.sleeves[0].ratePerUnit = 1_000e18;
        cfg.sleeves[0].cap = 1_000_000e18;
        cfg.sleeves[0].tiers = new Tier[](1);
        cfg.sleeves[0].tiers[0].kind = TierKind.RANGE;
        cfg.sleeves[0].tiers[0].minPerWallet = 1e18;

        og.mint(partner, 1_000_000e18);
        deal(address(MOR), partner, 1_000e18); // covers any creation fee
        vm.startPrank(partner);
        og.approve(address(factory), type(uint256).max);
        MOR.approve(address(factory), type(uint256).max);
        vault = BuilderVault(
            factory.createBuilderPool(
                cfg,
                1_000_000e18,
                string.concat("DAT fork test ", vm.toString(block.timestamp)),
                IBuildersV4.SubnetMetadata("dat-fork", "fork", "https://example.org", "")
            )
        );
        vm.stopPrank();
    }

    function test_fullLifecycleOnLiveBuilders() public {
        if (skipped) return;
        uint256 amount = 10_000e18;
        deal(address(MOR), alice, amount);
        vm.startPrank(alice);
        MOR.approve(address(vault), amount);
        uint256 id = vault.stake(0, 0, amount, 0);
        vm.stopPrank();

        address account = vault.position(id).account;
        (,, uint256 deposited,) = BUILDERS.usersData(account, vault.subnetId());
        assertEq(deposited, amount, "stake is in the subnet");
        assertEq(MOR.balanceOf(address(vault)), 0);

        // The subnet earns MOR with time, and only the splitter receives it.
        skip(30 days);
        uint256 pending = vault.pendingSubnetMor();
        console2.log("MOR earned by 10,000 MOR in 30 days", pending / 1e18);
        assertGt(pending, 0, "subnet earned MOR");

        address receiver = vault.morReceiver();
        uint256 beforeReceiver = MOR.balanceOf(receiver);
        vm.prank(makeAddr("anyone"));
        vault.claimSubnetMor();
        uint256 got = MOR.balanceOf(receiver) - beforeReceiver;
        console2.log("MOR at splitter after claim", got / 1e18);
        assertGt(got, 0, "splitter received MOR");

        address splitter = splitterDeployer.deploySplitter(factory.poolSalt(address(vault)), partner);
        assertEq(splitter, receiver);
        uint256 partnerBefore = MOR.balanceOf(partner);
        MorSplitter(splitter).distribute();
        assertEq(MOR.balanceOf(feeWallet), got / 10, "DAT fee");
        assertEq(MOR.balanceOf(partner) - partnerBefore, got - got / 10, "Partner share");

        // Stake comes back in full at unlock, with no Morpheus withdraw fee.
        skip(335 days);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(MOR.balanceOf(alice), amount, "full stake back");
        assertApproxEqAbs(og.balanceOf(alice), 10_000e18, 1e9, "OG Tokens");
    }

    function test_prefetchOnLiveBuilders() public {
        if (skipped) return;
        deal(address(MOR), alice, 100e18);
        vm.startPrank(alice);
        MOR.approve(address(vault), 100e18);
        uint256 id = vault.stake(0, 0, 100e18, 0);
        vm.stopPrank();
        skip(336 days);
        vault.prefetch(vault.position(id).account);
        assertEq(MOR.balanceOf(address(vault)), 100e18);
    }
}
