// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolTypes} from "../../src/interfaces/IPoolTypes.sol";
import {IDepositPool} from "../../src/interfaces/IDepositPool.sol";
import {PoolFactory} from "../../src/ethereum/PoolFactory.sol";
import {PoolVault} from "../../src/ethereum/PoolVault.sol";
import {CapitalAccount} from "../../src/ethereum/CapitalAccount.sol";
import {MorpheusAdapter} from "../../src/ethereum/MorpheusAdapter.sol";
import {ExitOnlyAdapter} from "../../src/ethereum/ExitOnlyAdapter.sol";
import {MockERC20} from "../mocks/Mocks.sol";

interface IDistributorView {
    function chainLinkDataConsumer() external view returns (address);
    function depositPoolAddresses(uint256 idx, uint256 i) external view returns (address);
    function depositPools(uint256 idx, address dp)
        external
        view
        returns (address, string memory, uint256, uint256, uint256, uint8, address, bool);
}

interface IChainLinkDataConsumer {
    function getPathId(string memory path) external pure returns (bytes32);
    function getChainLinkDataFeedLatestAnswer(bytes32 pathId) external view returns (uint256);
}

interface ILido {
    function submit(address referral) external payable returns (uint256);
}

interface IOwnedDepositPool {
    function setRewardPoolProtocolDetails(uint256, uint128, uint128, uint128, uint256) external;
}

/// @notice Runs DAT against live Morpheus Capital v7 on an Ethereum mainnet fork.
/// `ETH_RPC_URL=<rpc> forge test --match-path test/fork/* -vv`. Skipped without ETH_RPC_URL.
contract MorpheusForkTest is Test, IPoolTypes {
    address constant USDC_POOL = 0x6cCE082851Add4c535352f596662521B4De4750E;
    address constant STETH_POOL = 0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790;
    address constant USDT_POOL = 0x3B51989212BEdaB926794D6bf8e9E991218cf116;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant DISTRIBUTOR = 0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant MORPHEUS_OWNER = 0x1FE04BC15Cf2c5A2d41a0b3a96725596676eBa1E;

    address admin = makeAddr("multisig");
    address guardian = makeAddr("guardian");
    address referral = makeAddr("referral");
    address partner = makeAddr("partner");
    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");

    PoolFactory factory;
    MorpheusAdapter adapter;
    PoolVault vault;
    MockERC20 exampleToken;
    bool noRpc;

    function setUp() public {
        string memory rpc = vm.envOr("ETH_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            noRpc = true;
            return;
        }
        vm.createSelectFork(rpc);

        address[] memory dps = new address[](3);
        dps[0] = USDC_POOL;
        dps[1] = STETH_POOL;
        dps[2] = USDT_POOL;
        uint256[] memory idx = new uint256[](3);
        adapter = new MorpheusAdapter(admin, dps, idx);
        ExitOnlyAdapter exitAdapter = new ExitOnlyAdapter(admin, dps, idx);
        address[] memory tokens = new address[](3);
        tokens[0] = USDC;
        tokens[1] = STETH;
        tokens[2] = USDT;
        factory = new PoolFactory(
            PoolFactory.InitParams({
                admin: admin,
                poolVaultImpl: address(new PoolVault()),
                capitalAccountImpl: address(new CapitalAccount()),
                adapter: address(adapter),
                exitAdapter: address(exitAdapter),
                splitterDeployer: makeAddr("arbSplitterDeployer"),
                splitterImpl: makeAddr("arbSplitterImpl"),
                feeWallet: makeAddr("feeWallet"),
                referralAddress: referral,
                feeBps: 1000,
                stakeTokens: tokens,
                depositPools: dps
            })
        );
        vm.startPrank(admin);
        factory.grantRole(factory.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();

        exampleToken = new MockERC20("EXM", "EXM", 18);
        exampleToken.mint(partner, 1_000_000e18);
        vm.startPrank(partner);
        exampleToken.approve(address(factory), 1_000_000e18);
        vault = PoolVault(factory.createPool(_config(), 1_000_000e18));
        vm.stopPrank();
        vm.warp(vault.depositStart());
    }

    function _config() internal view returns (PoolConfig memory cfg) {
        cfg.rewardToken = address(exampleToken);
        cfg.depositStart = uint64(block.timestamp + 1);
        cfg.depositEnd = uint64(block.timestamp + 90 days);
        cfg.epochLength = 30 days;
        cfg.lockOptions = new LockOption[](1);
        cfg.lockOptions[0] = LockOption(365 days, 10_000);
        cfg.sleeves = new SleeveConfig[](3);
        cfg.sleeves[0].stakeToken = USDC;
        cfg.sleeves[0].unit = 1e12;
        cfg.sleeves[0].ratePerUnit = 20_000e18;
        cfg.sleeves[0].cap = 10_000_000e6;
        cfg.sleeves[0].tiers = new Tier[](1);
        cfg.sleeves[0].tiers[0].minPerWallet = 1e6;
        cfg.sleeves[1].stakeToken = STETH;
        cfg.sleeves[1].unit = 500e18;
        cfg.sleeves[1].ratePerUnit = 10_000e18;
        cfg.sleeves[1].cap = 5_000e18;
        cfg.sleeves[1].tiers = new Tier[](1);
        cfg.sleeves[1].tiers[0].minPerWallet = 0.01e18;
        cfg.sleeves[2].stakeToken = USDT;
        cfg.sleeves[2].unit = 1e12;
        cfg.sleeves[2].ratePerUnit = 20_000e18;
        cfg.sleeves[2].cap = 10_000_000e6;
        cfg.sleeves[2].tiers = new Tier[](1);
        cfg.sleeves[2].tiers[0].minPerWallet = 1e6;
    }

    bytes32[] priceIds;
    uint256[] prices;

    /// @dev Freezes Morpheus's Chainlink prices at their current values so long warps don't make them stale.
    function _freezePrices() internal {
        IDistributorView d = IDistributorView(DISTRIBUTOR);
        IChainLinkDataConsumer c = IChainLinkDataConsumer(d.chainLinkDataConsumer());
        for (uint256 i;; ++i) {
            try d.depositPoolAddresses(0, i) returns (address dp) {
                (, string memory path,,,,,,) = d.depositPools(0, dp);
                bytes32 id = c.getPathId(path);
                priceIds.push(id);
                prices.push(c.getChainLinkDataFeedLatestAnswer(id));
            } catch {
                break;
            }
        }
        _applyPrices();
    }

    function _applyPrices() internal {
        address c = IDistributorView(DISTRIBUTOR).chainLinkDataConsumer();
        for (uint256 i; i < priceIds.length; ++i) {
            vm.mockCall(
                c,
                abi.encodeCall(IChainLinkDataConsumer.getChainLinkDataFeedLatestAnswer, (priceIds[i])),
                abi.encode(prices[i])
            );
        }
    }

    function _stakeUsdc(uint256 amount) internal returns (uint256 id) {
        deal(USDC, alice, amount);
        vm.startPrank(alice);
        IERC20(USDC).approve(address(vault), amount);
        id = vault.stake(0, 0, amount, 0);
        vm.stopPrank();
    }

    function test_fork_liveSettings() public {
        vm.skip(noRpc);
        (uint128 w, uint128 cs, uint128 cc, uint256 minStake,) = IDepositPool(USDC_POOL).rewardPoolsProtocolDetails(0);
        console2.log("USDC withdrawLockPeriodAfterStake", w);
        console2.log("USDC claimLockPeriodAfterStake   ", cs);
        console2.log("USDC claimLockPeriodAfterClaim   ", cc);
        console2.log("USDC minimalStake                ", minStake);
        assertEq(IDepositPool(USDC_POOL).version(), 7);
        assertTrue(adapter.isHealthy(USDC_POOL));
        assertTrue(adapter.isHealthy(STETH_POOL));
    }

    function test_fork_usdcStakeClaimWithdraw() public {
        vm.skip(noRpc);
        _freezePrices();
        uint256 id = _stakeUsdc(10_000e6);
        address acct = vault.position(id).account;
        assertApproxEqAbs(adapter.deposited(USDC_POOL, acct), 10_000e6, 2);
        (,,,,,,,, address ref) = IDepositPool(USDC_POOL).usersData(acct, 0);
        assertEq(ref, referral);

        // MOR claim after the 14-day claim lock: measure the LayerZero fee.
        vm.warp(block.timestamp + 15 days);
                vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vault.claimMor{value: 0.05 ether}(0, 0, 0);
        console2.log("LayerZero fee paid (wei)", 1 ether - keeper.balance);

        // Pre-fetch 30 days before unlock, then withdraw from the vault.
        (,, uint256 prefetchAt) = vault.accountTimes(acct);
        vm.warp(prefetchAt);
        vault.prefetch(acct);
        deal(USDC, address(vault), IERC20(USDC).balanceOf(address(vault)) + 10); // dust reserve
        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(IERC20(USDC).balanceOf(alice), 10_000e6);
        assertEq(exampleToken.balanceOf(alice), 200e18);
    }

    function test_fork_stethStakeAndWithdraw() public {
        vm.skip(noRpc);
        _freezePrices();
        vm.deal(alice, 10 ether);
        vm.startPrank(alice);
        ILido(STETH).submit{value: 5 ether}(address(0));
        uint256 bal = IERC20(STETH).balanceOf(alice);
        IERC20(STETH).approve(address(vault), bal);
        uint256 id = vault.stake(1, 0, bal, 0);
        vm.stopPrank();
        PoolVault.Position memory p = vault.position(id);
        console2.log("stETH recorded principal", p.amount);
        assertApproxEqAbs(p.amount, 5 ether, 3);

        vm.warp(p.end);
        deal(alice, 0);
        vm.prank(alice);
        vault.withdraw(id);
        // A year of Lido rebase on the Morpheus side is not ours; the vault returns exactly the recorded amount
        // (stETH share rounding can drop up to 2 wei on the transfer itself).
        assertApproxEqAbs(IERC20(STETH).balanceOf(alice), p.amount, 2);
    }

    /// @notice USDT: no return value on transfer/approve, and approve must go through zero. Two stakes into the
    /// same Capital Account exercise the allowance reset.
    function test_fork_usdtStakeClaimWithdraw() public {
        vm.skip(noRpc);
        _freezePrices();
        assertTrue(adapter.isHealthy(USDT_POOL));
        deal(USDT, alice, 15_000e6);
        vm.startPrank(alice);
        SafeERC20.forceApprove(IERC20(USDT), address(vault), 15_000e6);
        uint256 a = vault.stake(2, 0, 10_000e6, 0);
        uint256 b = vault.stake(2, 0, 5_000e6, 0);
        vm.stopPrank();
        address acct = vault.position(a).account;
        assertEq(vault.position(b).account, acct);
        assertApproxEqAbs(adapter.deposited(USDT_POOL, acct), 15_000e6, 2);
        assertEq(IERC20(USDT).allowance(acct, USDT_POOL), 0);
        assertEq(IERC20(USDT).allowance(acct, DISTRIBUTOR), 0);

        vm.warp(block.timestamp + 15 days);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vault.claimMor{value: 0.05 ether}(2, 0, 0);

        vm.warp(vault.position(a).end);
        deal(USDT, address(vault), 10); // dust reserve
        vm.startPrank(alice);
        vault.withdraw(a);
        vault.withdraw(b);
        vm.stopPrank();
        assertEq(IERC20(USDT).balanceOf(alice), 15_000e6);
        assertEq(exampleToken.balanceOf(alice), 300e18);
    }

    /// @notice Hostile drill: Morpheus raises its locks. New stakes stop; existing principal still exits.
    function test_fork_drill_lockChangeTripsBreaker() public {
        vm.skip(noRpc);
        _freezePrices();
        uint256 id = _stakeUsdc(10_000e6);
        vm.prank(MORPHEUS_OWNER);
        IOwnedDepositPool(USDC_POOL).setRewardPoolProtocolDetails(0, 60 days, 90 days, 90 days, 1e6);
        assertFalse(adapter.isHealthy(USDC_POOL));

        deal(USDC, keeper, 1_000e6);
        vm.startPrank(keeper);
        IERC20(USDC).approve(address(vault), 1_000e6);
        vm.expectRevert(PoolVault.DepositsHalted.selector);
        vault.stake(0, 0, 1_000e6, 0);
        vm.stopPrank();

        vm.warp(vault.position(id).end);
        deal(USDC, address(vault), 10);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(IERC20(USDC).balanceOf(alice), 10_000e6);
    }

    /// @notice Hostile drill: Morpheus withdraw reverts (pause, upgrade, stale price). Withdraw goes ExitPending
    /// and is completed by anyone once Morpheus works again.
    function test_fork_drill_withdrawRevertsThenRecovers() public {
        vm.skip(noRpc);
        _freezePrices();
        uint256 id = _stakeUsdc(10_000e6);
        vm.warp(vault.position(id).end);
        vm.mockCallRevert(USDC_POOL, abi.encodeWithSelector(IDepositPool.withdraw.selector), "paused");
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(uint8(vault.position(id).status), uint8(PoolVault.Status.ExitPending));

        vm.clearMockedCalls();
        _applyPrices();
        deal(USDC, address(vault), 10);
        vm.prank(keeper);
        vault.processExit(id);
        assertEq(IERC20(USDC).balanceOf(alice), 10_000e6);
    }

    /// @notice Emergency exit pulls principal from live Morpheus immediately.
    function test_fork_emergencyExit() public {
        vm.skip(noRpc);
        _freezePrices();
        uint256 id = _stakeUsdc(10_000e6);
        address acct = vault.position(id).account;
        vm.warp(block.timestamp + 8 days); // past Morpheus's 7-day withdraw lock
        vm.prank(guardian);
        vault.emergencyExit(acct);
        assertEq(adapter.deposited(USDC_POOL, acct), 0);
        assertApproxEqAbs(IERC20(USDC).balanceOf(address(vault)), 10_000e6, 2);
    }
}
