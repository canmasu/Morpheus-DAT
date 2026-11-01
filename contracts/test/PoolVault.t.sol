// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {PoolVault} from "../src/ethereum/PoolVault.sol";
import {PoolFactory} from "../src/ethereum/PoolFactory.sol";
import {CapitalAccount} from "../src/ethereum/CapitalAccount.sol";

contract PoolVaultTest is Base {
    PoolVault vault;

    function setUp() public override {
        super.setUp();
        vault = createExamplePool(false);
        vm.warp(vault.depositStart());
    }

    // ------------------------------------------------------------ reward math (docs tables)

    function test_quoteMatchesExampleTables() public view {
        // USDC: $1M at 60 months = 50,000 EXM/yr x 5 = 250,000 EXM
        assertEq(vault.quote(0, 0, 1_000_000e6, 4), 250_000e18);
        assertEq(vault.quote(0, 0, 1_000_000e6, 0), 20_000e18);
        assertEq(vault.quote(0, 0, 1_000_000e6, 1), 44_000e18);
        // Alpha brackets: proportional to the amount at the bracket's multiplier
        assertEq(vault.quote(0, 1, 100e6, 0), 0.1e18);
        assertEq(vault.quote(0, 1, 999e6, 0), 0.999e18);
        assertEq(vault.quote(0, 1, 1_000e6, 0), 2e18);
        assertEq(vault.quote(0, 1, 10_000e6, 0), 30e18);
        assertEq(vault.quote(0, 1, 100_000e6, 0), 500e18);
        assertEq(vault.quote(0, 1, 999_999e6, 0), 4_999.995e18);
        // stETH: 500 stETH -> 10,000 / 22,000 / 37,500 / 60,000 / 125,000 EXM over the lock
        assertEq(vault.quote(1, 0, 500e18, 0), 10_000e18);
        assertEq(vault.quote(1, 0, 500e18, 1), 22_000e18);
        assertEq(vault.quote(1, 0, 500e18, 2), 37_500e18);
        assertEq(vault.quote(1, 0, 500e18, 3), 60_000e18);
        assertEq(vault.quote(1, 0, 5_000e18, 4), 1_250_000e18);
    }

    function test_stakeReservesExactReward() public {
        uint256 id = stakeUsdc(vault, alice, 1_000_000e6, 4);
        PoolVault.Position memory p = vault.position(id);
        assertEq(p.reward, 250_000e18);
        assertEq(vault.committed(), 250_000e18);
        assertEq(vault.available(), BUDGET - 250_000e18);
        assertEq(p.end, block.timestamp + 5 * MONTH12);
    }

    function test_revertWhenBudgetTooSmall() public {
        stakeUsdc(vault, alice, 5_000_000e6, 4); // 1,250,000 EXM
        usdc.mint(bob, 4_000_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 4_000_000e6);
        vm.expectRevert(PoolVault.InsufficientBudget.selector); // needs 1,000,000, 750,000 left
        vault.stake(0, 0, 4_000_000e6, 4);
        vm.stopPrank();
    }

    function test_walletLimitsAndCap() public {
        usdc.mint(alice, 10_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(PoolVault.WalletLimit.selector);
        vault.stake(0, 0, 999e6, 0);
        vault.stake(0, 0, 3_000_000e6, 0);
        vm.expectRevert(PoolVault.WalletLimit.selector); // 5M max per wallet in the tier
        vault.stake(0, 0, 2_000_001e6, 0);
        vm.stopPrank();
    }

    function testFuzz_bracketPicksHighestReachedBracket(uint64 raw) public view {
        uint256 a = bound(raw, 100e6, 1_000_000e6 - 1);
        uint256 mult = a >= 100_000e6 ? 2_500 : a >= 10_000e6 ? 1_500 : a >= 1_000e6 ? 1_000 : 500;
        // 20,000 EXM per $1M per year, 12 months
        assertEq(vault.quote(0, 1, a, 0), (a * 20_000e18 * mult) / (1e12 * 10_000));
    }

    function test_bracketTierLimitsAndLock() public {
        usdc.mint(alice, 2_000_000e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(PoolVault.InvalidTier.selector); // Alpha is 12 months only
        vault.stake(0, 1, 1_000e6, 2);
        vm.expectRevert(PoolVault.WalletLimit.selector); // below $100
        vault.stake(0, 1, 99.99e6, 0);
        vm.expectRevert(PoolVault.WalletLimit.selector); // $1M is Omega
        vault.stake(0, 1, 1_000_000e6, 0);
        uint256 id = vault.stake(0, 1, 101.1e6, 0); // still the $100 bracket
        vm.stopPrank();
        assertEq(vault.position(id).amount, 101.1e6);
        assertEq(vault.position(id).reward, 0.1011e18);
        assertEq(vault.position(id).end - vault.position(id).start, MONTH12);
    }

    // ------------------------------------------------------------ Capital Accounts (flow 3)

    function test_flow3_accountRouting() public {
        // A stakes 1,000 USDC 12m on day 9, B 500 USDC 12m on day 19: same account.
        vm.warp(vault.depositStart() + 9 days);
        uint256 a = stakeUsdc(vault, alice, 1_000e6, 0);
        vm.warp(vault.depositStart() + 19 days);
        uint256 b = stakeUsdc(vault, bob, 1_000e6, 0);
        address acct = vault.position(a).account;
        assertEq(vault.position(b).account, acct);
        assertEq(adapter.deposited(address(usdcPool), acct), 2_000e6);
        // Different lock, same epoch: different account.
        uint256 c = stakeUsdc(vault, bob, 1_000e6, 1);
        assertTrue(vault.position(c).account != acct);
        // Next epoch, same lock: different account.
        vm.warp(vault.depositStart() + 40 days);
        uint256 d = stakeUsdc(vault, bob, 1_000e6, 0);
        assertTrue(vault.position(d).account != acct);
        assertEq(vault.accountCount(), 3);
        // Referral passed on every stake; claim receiver set to the splitter.
        (,,,,,,,, address ref) = usdcPool.usersData(acct, 0);
        assertEq(ref, referral);
        assertEq(usdcPool.claimReceiver(0, acct), vault.morReceiver());
    }

    function test_stakeWorksWithoutSetClaimReceiver() public {
        usdcPool.setNoClaimReceiver(true);
        uint256 id = stakeUsdc(vault, alice, 1_000e6, 0);
        address acct = vault.position(id).account;
        assertEq(adapter.deposited(address(usdcPool), acct), 1_000e6);
        assertEq(usdcPool.claimReceiver(0, acct), address(0));
    }

    /// @dev Morpheus Sepolia: no setClaimReceiver, and the DepositPool pulls tokens itself.
    function test_sepoliaStyleDepositPool() public {
        usdcPool.setNoClaimReceiver(true);
        usdcPool.setPullsDirectly(true);
        uint256 id = stakeUsdc(vault, alice, 1_000e6, 0);
        address acct = vault.position(id).account;
        assertEq(usdc.balanceOf(address(usdcPool)), 1_000e6);
        assertEq(usdc.allowance(acct, address(usdcPool)), 0, "allowance reset");
        assertEq(usdc.allowance(acct, address(usdcPool.distributor())), 0, "allowance reset");
        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(usdc.balanceOf(alice), 1_000e6);
    }

    /// @dev Morpheus Sepolia releases 1 token per withdraw call. Nothing may be stranded or underpaid.
    function test_partialMorpheusWithdrawals() public {
        uint256 a = stakeUsdc(vault, alice, 3_000e6, 0);
        uint256 b = stakeUsdc(vault, bob, 2_000e6, 0);
        usdcPool.setWithdrawCap(2_000e6);
        vm.warp(vault.position(a).end);

        vm.prank(alice);
        vault.withdraw(a); // pulls 2,000 of 5,000: not done
        assertEq(uint8(vault.position(a).status), uint8(PoolVault.Status.ExitPending));
        assertEq(usdc.balanceOf(alice), 0);

        vault.processExit(a); // 4,000 of 5,000: still pending, no revert
        assertEq(uint8(vault.position(a).status), uint8(PoolVault.Status.ExitPending));
        vault.processExit(a); // all out: Alice paid in full
        assertEq(usdc.balanceOf(alice), 3_000e6);

        vm.prank(bob);
        vault.withdraw(b); // account already out: plain transfer
        assertEq(usdc.balanceOf(bob), 2_000e6);
    }

    function test_partialPrefetchContinues() public {
        uint256 a = stakeUsdc(vault, alice, 3_000e6, 0);
        address acct = vault.position(a).account;
        usdcPool.setWithdrawCap(1_000e6);
        (,, uint256 prefetchAt) = vault.accountTimes(acct);
        vm.warp(prefetchAt);
        vault.prefetch(acct);
        vault.prefetch(acct);
        (, bool inMorpheus,,,,,) = vault.accountInfo(acct);
        assertTrue(inMorpheus, "1,000 still in Morpheus");
        vault.prefetch(acct);
        (, inMorpheus,,,,,) = vault.accountInfo(acct);
        assertFalse(inMorpheus);
        vm.warp(vault.position(a).end);
        vm.prank(alice);
        vault.withdraw(a);
        assertEq(usdc.balanceOf(alice), 3_000e6);
    }

    function test_morBoostLocksClaimToEarliestUnlock() public {
        PoolVault boosted = createExamplePool(true);
        vm.warp(boosted.depositStart() + 5 days);
        uint256 id = stakeUsdc(boosted, alice, 1_000e6, 2);
        address acct = boosted.position(id).account;
        (,,,,, uint128 claimLockEnd,,,) = usdcPool.usersData(acct, 0);
        assertEq(claimLockEnd, boosted.depositStart() + 3 * MONTH12);
    }

    // ------------------------------------------------------------ rewards never touch Morpheus

    function test_rewardAccruesLinearlyAndClaimsWhileMorpheusBroken() public {
        uint256 id = stakeUsdc(vault, alice, 1_000_000e6, 0); // 20,000 EXM over 12 months
        vm.warp(block.timestamp + MONTH12 / 4);
        usdcPool.setBroken(true);
        assertEq(vault.accrued(id), 5_000e18);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        vault.claimReward(ids);
        assertEq(exampleToken.balanceOf(alice), 5_000e18);
        assertEq(vault.accrued(id), 0);
    }

    // ------------------------------------------------------------ exits

    function test_prefetchThenWithdrawNeedsNoMorpheus() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        address acct = vault.position(id).account;
        (,, uint256 prefetchAt) = vault.accountTimes(acct);

        vm.warp(prefetchAt - 1);
        vm.expectRevert(PoolVault.TooEarly.selector);
        vault.prefetch(acct);

        vm.warp(prefetchAt);
        vault.prefetch(acct); // anyone
        assertEq(usdc.balanceOf(address(vault)), 10_000e6);

        usdcPool.setBroken(true);
        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(exampleToken.balanceOf(alice), 200e18);
    }

    function test_withdrawBeforeUnlockReverts() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        vm.warp(vault.position(id).end - 1);
        vm.prank(alice);
        vm.expectRevert(PoolVault.StillLocked.selector);
        vault.withdraw(id);
    }

    function test_withdrawWithoutPrefetchPullsAccount() public {
        uint256 a = stakeUsdc(vault, alice, 10_000e6, 0);
        uint256 b = stakeUsdc(vault, bob, 5_000e6, 0);
        vm.warp(vault.position(a).end);
        vm.prank(alice);
        vault.withdraw(a);
        assertEq(usdc.balanceOf(alice), 10_000e6);
        // Bob's principal came back with the same pull and waits in the vault.
        assertEq(usdc.balanceOf(address(vault)), 5_000e6);
        vm.prank(bob);
        vault.withdraw(b);
        assertEq(usdc.balanceOf(bob), 5_000e6);
    }

    function test_exitPendingThenProcessExit() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        vm.warp(vault.position(id).end);
        usdcPool.setBroken(true);

        vm.prank(alice);
        vault.withdraw(id); // does not revert
        assertEq(uint8(vault.position(id).status), uint8(PoolVault.Status.ExitPending));
        assertEq(exampleToken.balanceOf(alice), 200e18, "reward still paid");
        assertEq(usdc.balanceOf(alice), 0);

        vm.expectRevert();
        vault.processExit(id);

        usdcPool.setBroken(false);
        vm.prank(bob); // anyone can retry, funds go to the owner
        vault.processExit(id);
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_dustReserveCoversAaveRounding() public {
        uint256 a = stakeUsdc(vault, alice, 10_000e6, 0);
        uint256 b = stakeUsdc(vault, bob, 10_000e6, 0);
        usdcPool.distributor().setShortfall(2);
        usdc.mint(address(vault), 10); // DAT-funded dust reserve
        vm.warp(vault.position(a).end);
        vm.prank(alice);
        vault.withdraw(a);
        vm.prank(bob);
        vault.withdraw(b);
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(usdc.balanceOf(bob), 10_000e6);
    }

    function test_shortfallWithoutReserveIsSharedProRata() public {
        uint256 a = stakeUsdc(vault, alice, 10_000e6, 0);
        uint256 b = stakeUsdc(vault, bob, 10_000e6, 0);
        usdcPool.distributor().setShortfall(2_000e6); // a large loss, e.g. slashing
        vm.warp(vault.position(a).end);
        vm.prank(alice);
        vault.withdraw(a);
        vm.prank(bob);
        vault.withdraw(b);
        assertEq(usdc.balanceOf(alice), 9_000e6);
        assertEq(usdc.balanceOf(bob), 9_000e6);
    }

    function test_emergencyExitKeepsLockOrExitEarly() public {
        uint256 a = stakeUsdc(vault, alice, 1_000_000e6, 0); // 20,000 EXM
        uint256 b = stakeUsdc(vault, bob, 1_000_000e6, 0);
        address acct = vault.position(a).account;

        vm.prank(alice);
        vm.expectRevert(PoolVault.NotGuardian.selector);
        vault.emergencyExit(acct);

        vm.warp(block.timestamp + 10 days);
        vm.prank(guardian);
        vault.emergencyExit(acct);
        assertEq(usdc.balanceOf(address(vault)), 2_000_000e6);

        // Alice leaves at 3 months with the reward accrued so far.
        vm.warp(vault.position(a).start + MONTH12 / 4);
        vm.prank(alice);
        vault.exitEarly(a);
        assertEq(usdc.balanceOf(alice), 1_000_000e6);
        assertEq(exampleToken.balanceOf(alice), 5_000e18);
        assertEq(vault.committed(), 5_000e18 + 20_000e18, "forfeit back to the budget");

        // Bob stays and withdraws at the original unlock with the full reward.
        vm.warp(vault.position(b).end);
        vm.prank(bob);
        vault.withdraw(b);
        assertEq(usdc.balanceOf(bob), 1_000_000e6);
        assertEq(exampleToken.balanceOf(bob), 20_000e18);
    }

    function test_exitEarlyOnlyAfterEmergency() public {
        uint256 a = stakeUsdc(vault, alice, 10_000e6, 0);
        vm.prank(alice);
        vm.expectRevert(PoolVault.NotEmergency.selector);
        vault.exitEarly(a);
    }

    // ------------------------------------------------------------ circuit breaker, adapters, pause

    function test_circuitBreakerBlocksStakesNotExits() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        usdcPool.setLocks(30 days, 14 days, 14 days, 1e6); // Morpheus raised the withdraw lock

        usdc.mint(bob, 10_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 10_000e6);
        vm.expectRevert(PoolVault.DepositsHalted.selector);
        vault.stake(0, 0, 10_000e6, 0);
        vm.stopPrank();

        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(usdc.balanceOf(alice), 10_000e6);

        // Multisig accepts the new settings after a fork test.
        vm.prank(admin);
        adapter.recordBaseline(address(usdcPool), 0);
        assertTrue(adapter.isHealthy(address(usdcPool)));
    }

    function test_versionChangeTripsBreaker() public {
        usdcPool.setVersion(8);
        assertFalse(adapter.isHealthy(address(usdcPool)));
        assertTrue(adapter.isHealthy(address(stethPool)));
    }

    function test_exitAdapterIsInstantAndWithdrawOnly() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        vm.prank(guardian);
        factory.useExitAdapter();

        usdc.mint(bob, 10_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 10_000e6);
        vm.expectRevert(PoolVault.DepositsHalted.selector);
        vault.stake(0, 0, 10_000e6, 0);
        vm.stopPrank();

        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(usdc.balanceOf(alice), 10_000e6);
    }

    function test_adapterSwapNeedsTimelock() public {
        address next = address(adapter); // stand-in
        vm.startPrank(admin);
        factory.queueAdapter(next);
        vm.expectRevert(PoolFactory.TimelockActive.selector);
        factory.applyAdapter();
        vm.warp(block.timestamp + 48 hours);
        factory.applyAdapter();
        vm.stopPrank();
    }

    function test_pauseScopes() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        vm.prank(pauser);
        factory.pause(1);
        usdc.mint(bob, 10_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 10_000e6);
        vm.expectRevert(PoolVault.Paused.selector);
        vault.stake(0, 0, 10_000e6, 0);
        vm.stopPrank();

        vm.prank(pauser);
        vm.expectRevert(); // pauser cannot pause everything
        factory.pause(2);
        vm.prank(guardian);
        factory.pause(2);

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        vm.expectRevert(PoolVault.Paused.selector);
        vault.claimReward(ids);

        // Unlocked principal is never pausable.
        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        assertEq(usdc.balanceOf(alice), 10_000e6);
    }

    // ------------------------------------------------------------ MOR claims

    function test_claimMorRefundsCaller() public {
        stakeUsdc(vault, alice, 10_000e6, 0);
        vm.warp(block.timestamp + 15 days);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vault.claimMor{value: 0.01 ether}(0, 0, 0);
        assertEq(bob.balance, 1 ether - 0.005 ether);
    }

    // ------------------------------------------------------------ stETH sleeve

    function test_stethRoundTripRecordsWhatArrived() public {
        uint256 id = stakeSteth(vault, alice, 500e18, 0);
        PoolVault.Position memory p = vault.position(id);
        assertEq(p.amount, 500e18 - 1, "1 wei lost on the way in");
        steth.mint(address(vault), 10); // dust reserve
        vm.warp(p.end);
        vm.prank(alice);
        vault.withdraw(id);
        // Vault sends exactly the recorded amount; stETH itself drops 1 wei on that last hop.
        assertEq(steth.balanceOf(alice), 500e18 - 2);
    }

    function test_stethRebaseSurplusSweptToFeeWalletAfterExit() public {
        uint256 id = stakeSteth(vault, alice, 100e18, 0);
        vm.warp(vault.position(id).end);
        vm.prank(alice);
        vault.withdraw(id);
        steth.rebase(address(vault), 0.3e18, false);
        vm.warp(vault.depositEnd());
        vault.sweepSurplus(1);
        assertGt(steth.balanceOf(feeWallet), 0.29e18);
    }

    function test_surplusLockedWhileSleeveActive() public {
        stakeSteth(vault, alice, 100e18, 0);
        vm.warp(vault.depositEnd());
        vm.expectRevert(PoolVault.SleeveActive.selector);
        vault.sweepSurplus(1);
    }

    // ------------------------------------------------------------ Partner

    function test_partnerWithdrawsOnlyUnreservedAfterDepositEnd() public {
        stakeUsdc(vault, alice, 1_000_000e6, 4); // reserves 250,000
        vm.startPrank(partner);
        vm.expectRevert(PoolVault.DepositsClosed.selector);
        vault.withdrawUnreserved(1);
        vm.warp(vault.depositEnd());
        vm.expectRevert(PoolVault.InsufficientBudget.selector);
        vault.withdrawUnreserved(BUDGET - 250_000e18 + 1);
        vault.withdrawUnreserved(BUDGET - 250_000e18);
        vm.stopPrank();
        assertEq(exampleToken.balanceOf(address(vault)), 250_000e18);
    }

    function test_setDatesRules() public {
        uint64 start = vault.depositStart();
        uint64 end = vault.depositEnd();
        vm.startPrank(partner);
        vm.expectRevert(PoolVault.InvalidConfig.selector);
        vault.setDates(start, end - 1); // cannot shorten once open
        vm.expectRevert(PoolVault.InvalidConfig.selector);
        vault.setDates(start + 1, end); // cannot move the start once open
        vault.setDates(start, end + 30 days);
        vm.stopPrank();
        assertEq(vault.depositEnd(), end + 30 days);
    }

    function test_featuredFlag() public {
        vm.prank(admin);
        factory.setFeatured(address(vault), true);
        assertEq(factory.featuredPools().length, 1);
        vm.prank(alice);
        vm.expectRevert();
        factory.setFeatured(address(vault), false);
    }

    // ------------------------------------------------------------ invariants (fuzz)

    function testFuzz_principalAndRewardsConserved(uint96 a1, uint96 a2, uint8 l1, uint8 l2, uint32 dt) public {
        uint256 amt1 = bound(a1, 1_000e6, 1_000_000e6);
        uint256 amt2 = bound(a2, 1_000e6, 1_000_000e6);
        uint256 lock1 = l1 % 3;
        uint256 lock2 = l2 % 3;
        uint256 id1 = stakeUsdc(vault, alice, amt1, lock1);
        vm.warp(block.timestamp + bound(dt, 0, 60 days));
        uint256 id2 = stakeUsdc(vault, bob, amt2, lock2);

        assertGe(exampleToken.balanceOf(address(vault)), vault.committed() - vault.paid());

        vm.warp(block.timestamp + 4 * MONTH12);
        vm.prank(alice);
        vault.withdraw(id1);
        vm.prank(bob);
        vault.withdraw(id2);

        assertEq(usdc.balanceOf(alice), amt1);
        assertEq(usdc.balanceOf(bob), amt2);
        assertEq(exampleToken.balanceOf(alice), vault.position(id1).reward);
        assertEq(exampleToken.balanceOf(bob), vault.position(id2).reward);
        assertEq(vault.paid(), vault.committed());
    }

    function test_capitalAccountOnlyVault() public {
        uint256 id = stakeUsdc(vault, alice, 10_000e6, 0);
        CapitalAccount acct = CapitalAccount(payable(vault.position(id).account));
        vm.expectRevert(CapitalAccount.NotVault.selector);
        acct.withdrawAll();
        vm.expectRevert(CapitalAccount.NotVault.selector);
        acct.deposit(0, alice);
    }
}
