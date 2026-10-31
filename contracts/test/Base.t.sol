// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPoolTypes} from "../src/interfaces/IPoolTypes.sol";
import {PoolFactory} from "../src/ethereum/PoolFactory.sol";
import {PoolVault} from "../src/ethereum/PoolVault.sol";
import {CapitalAccount} from "../src/ethereum/CapitalAccount.sol";
import {MorpheusAdapter} from "../src/ethereum/MorpheusAdapter.sol";
import {ExitOnlyAdapter} from "../src/ethereum/ExitOnlyAdapter.sol";
import {MorSplitter} from "../src/arbitrum/MorSplitter.sol";
import {SplitterDeployer} from "../src/arbitrum/SplitterDeployer.sol";
import {ArbFeeConfig} from "../src/arbitrum/ArbFeeConfig.sol";
import {MockERC20, MockStETH, MockDepositPool} from "./mocks/Mocks.sol";

/// @dev Full DAT system on mocks, with the example pool from docs/proposal.md.
abstract contract Base is Test, IPoolTypes {
    address admin = makeAddr("multisig");
    address guardian = makeAddr("guardian");
    address pauser = makeAddr("pauser");
    address feeWallet = makeAddr("feeWallet");
    address referral = makeAddr("referral");
    address partner = makeAddr("partner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockERC20 usdc;
    MockStETH steth;
    MockERC20 exampleToken;
    MockERC20 mor;
    MockDepositPool usdcPool;
    MockDepositPool stethPool;

    MorpheusAdapter adapter;
    ExitOnlyAdapter exitAdapter;
    PoolFactory factory;
    ArbFeeConfig feeConfig;
    SplitterDeployer splitterDeployer;

    uint64 constant MONTH12 = 365 days;
    uint256 constant BUDGET = 2_000_000e18;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        steth = new MockStETH();
        exampleToken = new MockERC20("EXM", "EXM", 18);
        mor = new MockERC20("MOR", "MOR", 18);
        usdcPool = new MockDepositPool(address(usdc), 1e6);
        stethPool = new MockDepositPool(address(steth), 0.01e18);

        // "Arbitrum" side, deployed first so Ethereum can predict splitters.
        feeConfig = new ArbFeeConfig(admin, address(mor), 1000, feeWallet);
        MorSplitter splitterImpl = new MorSplitter();
        splitterDeployer = new SplitterDeployer(address(splitterImpl), address(feeConfig));

        address[] memory dps = new address[](2);
        dps[0] = address(usdcPool);
        dps[1] = address(stethPool);
        uint256[] memory idx = new uint256[](2);
        adapter = new MorpheusAdapter(admin, dps, idx);
        exitAdapter = new ExitOnlyAdapter(admin, dps, idx);

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(steth);
        factory = new PoolFactory(
            PoolFactory.InitParams({
                admin: admin,
                poolVaultImpl: address(new PoolVault()),
                capitalAccountImpl: address(new CapitalAccount()),
                adapter: address(adapter),
                exitAdapter: address(exitAdapter),
                splitterDeployer: address(splitterDeployer),
                splitterImpl: address(splitterImpl),
                feeWallet: feeWallet,
                referralAddress: referral,
                feeBps: 1000,
                stakeTokens: tokens,
                depositPools: dps
            })
        );
        vm.startPrank(admin);
        factory.grantRole(factory.GUARDIAN_ROLE(), guardian);
        factory.grantRole(factory.PAUSER_ROLE(), pauser);
        factory.grantRole(factory.FEATURER_ROLE(), admin);
        vm.stopPrank();
    }

    function exampleConfig(bool morBoost) internal view returns (PoolConfig memory cfg) {
        cfg.rewardToken = address(exampleToken);
        cfg.depositStart = uint64(block.timestamp + 1 days);
        cfg.depositEnd = uint64(block.timestamp + 181 days);
        cfg.epochLength = 30 days;
        cfg.morBoost = morBoost;

        cfg.lockOptions = new LockOption[](5);
        cfg.lockOptions[0] = LockOption(MONTH12, 10_000);
        cfg.lockOptions[1] = LockOption(2 * MONTH12, 11_000);
        cfg.lockOptions[2] = LockOption(3 * MONTH12, 12_500);
        cfg.lockOptions[3] = LockOption(4 * MONTH12, 15_000);
        cfg.lockOptions[4] = LockOption(5 * MONTH12, 25_000);

        cfg.sleeves = new SleeveConfig[](2);
        // USDC: 20,000 EXM per $1M per year.
        cfg.sleeves[0].stakeToken = address(usdc);
        cfg.sleeves[0].unit = 1e12;
        cfg.sleeves[0].ratePerUnit = 20_000e18;
        cfg.sleeves[0].cap = 10_000_000e6;
        cfg.sleeves[0].tiers = new Tier[](2);
        cfg.sleeves[0].tiers[0].kind = TierKind.RANGE;
        cfg.sleeves[0].tiers[0].minPerWallet = 1_000e6;
        cfg.sleeves[0].tiers[0].maxPerWallet = 5_000_000e6;
        // Alpha: fixed $100 for 12 months, 0.1 EXM for the year (0.05x the base rate).
        cfg.sleeves[0].tiers[1].kind = TierKind.FIXED;
        cfg.sleeves[0].tiers[1].amounts = new uint256[](1);
        cfg.sleeves[0].tiers[1].amounts[0] = 100e6;
        cfg.sleeves[0].tiers[1].multBps = new uint32[](1);
        cfg.sleeves[0].tiers[1].multBps[0] = 500;
        cfg.sleeves[0].tiers[1].lockOptionId = 0;
        // stETH: 10,000 EXM per 500 stETH per year.
        cfg.sleeves[1].stakeToken = address(steth);
        cfg.sleeves[1].unit = 500e18;
        cfg.sleeves[1].ratePerUnit = 10_000e18;
        cfg.sleeves[1].cap = 5_000e18;
        cfg.sleeves[1].tiers = new Tier[](1);
        cfg.sleeves[1].tiers[0].kind = TierKind.RANGE;
        cfg.sleeves[1].tiers[0].minPerWallet = 1e18;
    }

    function createExamplePool(bool morBoost) internal returns (PoolVault vault) {
        exampleToken.mint(partner, BUDGET);
        vm.startPrank(partner);
        exampleToken.approve(address(factory), BUDGET);
        vault = PoolVault(factory.createPool(exampleConfig(morBoost), BUDGET));
        vm.stopPrank();
    }

    function stakeUsdc(PoolVault vault, address who, uint256 amount, uint256 lockId) internal returns (uint256 id) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        id = vault.stake(0, 0, amount, lockId);
        vm.stopPrank();
    }

    function stakeSteth(PoolVault vault, address who, uint256 amount, uint256 lockId) internal returns (uint256 id) {
        steth.mint(who, amount);
        vm.startPrank(who);
        steth.approve(address(vault), amount);
        id = vault.stake(1, 0, amount, lockId);
        vm.stopPrank();
    }
}
