// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolTypes} from "../../src/interfaces/IPoolTypes.sol";
import {IBuildersV4} from "../../src/interfaces/IBuildersV4.sol";
import {PoolFactory} from "../../src/ethereum/PoolFactory.sol";
import {PoolVault} from "../../src/ethereum/PoolVault.sol";
import {CapitalAccount} from "../../src/ethereum/CapitalAccount.sol";
import {BuilderPoolFactory} from "../../src/base/BuilderPoolFactory.sol";
import {BuilderVault} from "../../src/base/BuilderVault.sol";
import {BuildersAdapter} from "../../src/base/BuildersAdapter.sol";
import {BuildersExitAdapter} from "../../src/base/BuildersExitAdapter.sol";
import {MorSplitter} from "../../src/arbitrum/MorSplitter.sol";
import {SplitterDeployer} from "../../src/arbitrum/SplitterDeployer.sol";
import {ArbFeeConfig} from "../../src/arbitrum/ArbFeeConfig.sol";
import {MockERC20} from "../mocks/Mocks.sol";

/// @dev The BuildersV4 rules DAT depends on: admin-only claims, withdraw lock from the last deposit, creation fee.
contract MockBuilders {
    MockERC20 public immutable mor;
    uint256 public version = 4;
    address public rewardPool = address(0xBEEF);
    uint256 public minimalWithdrawLockPeriod = 7 days;
    uint256 public subnetCreationFeeAmount;
    bool public broken;

    mapping(bytes32 => IBuildersV4.Subnet) internal _subnets;
    mapping(bytes32 => IBuildersV4.SubnetMetadata) internal _metadata;
    mapping(bytes32 => uint256) public subnetDeposited;
    mapping(bytes32 => uint256) public pending;
    mapping(address => mapping(bytes32 => uint128)) internal _last;
    mapping(address => mapping(bytes32 => uint256)) internal _dep;

    constructor(MockERC20 mor_) {
        mor = mor_;
    }

    function depositToken() external view returns (address) {
        return address(mor);
    }

    function setVersion(uint256 v) external {
        version = v;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function setFee(uint256 f) external {
        subnetCreationFeeAmount = f;
    }

    function setMinLock(uint256 l) external {
        minimalWithdrawLockPeriod = l;
    }

    function accrue(bytes32 id, uint256 amount) external {
        pending[id] += amount;
    }

    function subnet(bytes32 id) external view returns (IBuildersV4.Subnet memory) {
        return _subnets[id];
    }

    function metadata(bytes32 id) external view returns (IBuildersV4.SubnetMetadata memory) {
        return _metadata[id];
    }

    function getSubnetId(string memory name) public view returns (bytes32) {
        return keccak256(abi.encodePacked(block.chainid, name));
    }

    function createSubnet(IBuildersV4.Subnet calldata s, IBuildersV4.SubnetMetadata calldata m) external {
        bytes32 id = getSubnetId(s.name);
        require(_subnets[id].admin == address(0), "exists");
        require(s.withdrawLockPeriodAfterDeposit >= minimalWithdrawLockPeriod, "lock");
        if (subnetCreationFeeAmount > 0) mor.transferFrom(msg.sender, address(0xFEE), subnetCreationFeeAmount);
        _subnets[id] = s;
        _metadata[id] = m;
    }

    function editSubnetMetadata(bytes32 id, IBuildersV4.SubnetMetadata calldata m) external {
        require(msg.sender == _subnets[id].admin, "admin");
        _metadata[id] = m;
    }

    function deposit(bytes32 id, uint256 amount) external {
        require(_subnets[id].admin != address(0), "subnet");
        mor.transferFrom(msg.sender, address(this), amount);
        _dep[msg.sender][id] += amount;
        subnetDeposited[id] += amount;
        _last[msg.sender][id] = uint128(block.timestamp);
    }

    function withdraw(bytes32 id, uint256 amount) external {
        require(!broken, "broken");
        require(block.timestamp > _last[msg.sender][id] + _subnets[id].withdrawLockPeriodAfterDeposit, "locked");
        if (amount > _dep[msg.sender][id]) amount = _dep[msg.sender][id];
        require(amount > 0, "nothing");
        _dep[msg.sender][id] -= amount;
        subnetDeposited[id] -= amount;
        mor.transfer(msg.sender, amount);
    }

    function claim(bytes32 id, address receiver) external {
        require(msg.sender == _subnets[id].admin || msg.sender == _subnets[id].claimAdmin, "BU: invalid caller");
        uint256 p = pending[id];
        require(p > 0, "BU: nothing to claim");
        pending[id] = 0;
        mor.mint(receiver, p);
    }

    function getCurrentSubnetRewards(bytes32 id) external view returns (uint256) {
        return pending[id];
    }

    function usersData(address u, bytes32 id) external view returns (uint128, uint128, uint256, uint256) {
        return (_last[u][id], 0, _dep[u][id], 0);
    }
}

contract BuilderVaultTest is Test, IPoolTypes {
    address admin = makeAddr("multisig");
    address guardian = makeAddr("guardian");
    address feeWallet = makeAddr("feeWallet");
    address partner = makeAddr("partner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint64 constant Y = 365 days;
    uint256 constant BUDGET = 1_000_000e18;
    string constant NAME = "DAT OG Pool";

    MockERC20 mor;
    MockERC20 og;
    MockBuilders builders;
    BuilderPoolFactory factory;
    BuildersExitAdapter exitAdapter;
    BuildersAdapter adapter;
    SplitterDeployer splitterDeployer;

    function setUp() public {
        vm.warp(1_800_000_000);
        mor = new MockERC20("MOR", "MOR", 18);
        og = new MockERC20("OG", "OG", 18);
        builders = new MockBuilders(mor);

        ArbFeeConfig feeConfig = new ArbFeeConfig(admin, address(mor), 1000, feeWallet);
        MorSplitter splitterImpl = new MorSplitter();
        splitterDeployer = new SplitterDeployer(address(splitterImpl), address(feeConfig));

        address[] memory list = new address[](1);
        list[0] = address(builders);
        adapter = new BuildersAdapter(admin, list);
        exitAdapter = new BuildersExitAdapter(admin, list);

        address[] memory tokens = new address[](1);
        tokens[0] = address(mor);
        factory = new BuilderPoolFactory(
            PoolFactory.InitParams({
                admin: admin,
                poolVaultImpl: address(new BuilderVault()),
                capitalAccountImpl: address(new CapitalAccount()),
                adapter: address(adapter),
                exitAdapter: address(exitAdapter),
                splitterDeployer: address(splitterDeployer),
                splitterImpl: address(splitterImpl),
                feeWallet: feeWallet,
                referralAddress: address(0),
                feeBps: 1000,
                stakeTokens: tokens,
                depositPools: list
            })
        );
        bytes32 guardianRole = factory.GUARDIAN_ROLE();
        vm.prank(admin);
        factory.grantRole(guardianRole, guardian);

        og.mint(partner, BUDGET);
        vm.prank(partner);
        og.approve(address(factory), BUDGET);
    }

    function _cfg() internal view returns (PoolConfig memory cfg) {
        cfg.rewardToken = address(og);
        cfg.depositStart = uint64(block.timestamp);
        cfg.depositEnd = uint64(block.timestamp + 180 days);
        cfg.epochLength = 30 days;
        cfg.lockOptions = new LockOption[](2);
        cfg.lockOptions[0] = LockOption(Y, 10_000);
        cfg.lockOptions[1] = LockOption(5 * Y, 25_000);
        cfg.sleeves = new SleeveConfig[](1);
        cfg.sleeves[0].stakeToken = address(mor);
        cfg.sleeves[0].unit = 1_000e18;
        cfg.sleeves[0].ratePerUnit = 1_000e18;
        cfg.sleeves[0].cap = 1_000_000e18;
        cfg.sleeves[0].tiers = new Tier[](1);
        cfg.sleeves[0].tiers[0].kind = TierKind.RANGE;
        cfg.sleeves[0].tiers[0].minPerWallet = 1e18;
    }

    function _meta() internal pure returns (IBuildersV4.SubnetMetadata memory) {
        return IBuildersV4.SubnetMetadata("dat-og", "An OG pool", "https://example.org", "");
    }

    function _create() internal returns (BuilderVault) {
        PoolConfig memory cfg = _cfg();
        IBuildersV4.SubnetMetadata memory m = _meta();
        vm.prank(partner);
        return BuilderVault(factory.createBuilderPool(cfg, BUDGET, NAME, m));
    }

    function _stake(BuilderVault v, address who, uint256 amount, uint256 lock) internal returns (uint256 id) {
        mor.mint(who, amount);
        vm.startPrank(who);
        mor.approve(address(v), amount);
        id = v.stake(0, 0, amount, lock);
        vm.stopPrank();
    }

    function test_createMakesVaultTheSubnetAdminForLife() public {
        BuilderVault v = _create();
        bytes32 id = builders.getSubnetId(NAME);
        assertEq(v.subnetId(), id);
        IBuildersV4.Subnet memory s = builders.subnet(id);
        assertEq(s.admin, address(v));
        assertEq(s.claimAdmin, address(v));
        assertEq(s.withdrawLockPeriodAfterDeposit, 7 days);
        assertEq(s.minimalDeposit, 0);
        assertEq(address(v.builders()), address(builders));
    }

    function test_partnerPaysCreationFee() public {
        builders.setFee(5e18);
        mor.mint(partner, 5e18);
        vm.prank(partner);
        mor.approve(address(factory), 5e18);
        BuilderVault v = _create();
        assertEq(mor.balanceOf(address(0xFEE)), 5e18);
        assertEq(mor.balanceOf(partner), 0);
        assertEq(mor.balanceOf(address(v)), 0);
        assertEq(mor.allowance(address(v), address(builders)), 0);
    }

    function test_plainCreatePoolIsDisabled() public {
        PoolConfig memory cfg = _cfg();
        vm.expectRevert(BuilderPoolFactory.UseCreateBuilderPool.selector);
        factory.createPool(cfg, 0);
    }

    function test_rejectsMorBoostAndSecondSleeve() public {
        PoolConfig memory cfg = _cfg();
        IBuildersV4.SubnetMetadata memory m = _meta();
        cfg.morBoost = true;
        vm.prank(partner);
        vm.expectRevert(BuilderPoolFactory.InvalidBuilderConfig.selector);
        factory.createBuilderPool(cfg, BUDGET, NAME, m);

        cfg = _cfg();
        SleeveConfig[] memory two = new SleeveConfig[](2);
        two[0] = cfg.sleeves[0];
        two[1] = cfg.sleeves[0];
        cfg.sleeves = two;
        vm.prank(partner);
        vm.expectRevert(BuilderPoolFactory.InvalidBuilderConfig.selector);
        factory.createBuilderPool(cfg, BUDGET, NAME, m);
    }

    function test_rejectsStakeTokenThatIsNotBuildersToken() public {
        MockERC20 other = new MockERC20("X", "X", 18);
        vm.prank(admin);
        factory.setStakeToken(address(other), address(builders));
        PoolConfig memory cfg = _cfg();
        IBuildersV4.SubnetMetadata memory m = _meta();
        cfg.sleeves[0].stakeToken = address(other);
        vm.prank(partner);
        vm.expectRevert(PoolVault.InvalidConfig.selector);
        factory.createBuilderPool(cfg, BUDGET, NAME, m);
    }

    function test_rejectsWithdrawLockLongerThanPrefetchWindow() public {
        builders.setMinLock(31 days);
        PoolConfig memory cfg = _cfg();
        IBuildersV4.SubnetMetadata memory m = _meta();
        vm.prank(partner);
        vm.expectRevert(PoolVault.InvalidConfig.selector);
        factory.createBuilderPool(cfg, BUDGET, NAME, m);
    }

    function test_nameAlreadyTakenReverts() public {
        _create();
        og.mint(partner, BUDGET);
        vm.prank(partner);
        og.approve(address(factory), BUDGET);
        PoolConfig memory cfg = _cfg();
        IBuildersV4.SubnetMetadata memory m = _meta();
        vm.prank(partner);
        vm.expectRevert(bytes("exists"));
        factory.createBuilderPool(cfg, BUDGET, NAME, m);
    }

    function test_setupSubnetOnlyFactoryAndOnce() public {
        BuilderVault v = _create();
        vm.expectRevert(BuilderVault.NotFactory.selector);
        v.setupSubnet("again", _meta());
        vm.prank(address(factory));
        vm.expectRevert(BuilderVault.SubnetAlreadySet.selector);
        v.setupSubnet("again", _meta());
    }

    function test_stakeGoesIntoTheSubnetAndComesBackInFull() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 1_000e18, 0);
        assertEq(builders.subnetDeposited(v.subnetId()), 1_000e18);
        assertEq(mor.balanceOf(address(v)), 0);
        assertEq(v.quote(0, 0, 1_000e18, 0), 1_000e18);

        vm.warp(block.timestamp + Y / 2);
        vm.prank(alice);
        v.claimReward(_ids(id));
        assertApproxEqAbs(og.balanceOf(alice), 500e18, 1e6);

        vm.expectRevert(PoolVault.StillLocked.selector);
        vm.prank(alice);
        v.withdraw(id);

        vm.warp(block.timestamp + Y / 2 + 1);
        vm.prank(alice);
        v.withdraw(id);
        assertEq(mor.balanceOf(alice), 1_000e18);
        assertEq(og.balanceOf(alice), 1_000e18);
        assertEq(builders.subnetDeposited(v.subnetId()), 0);
    }

    function test_prefetchPullsStakeBeforeUnlock() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 100e18, 0);
        address account = v.position(id).account;
        vm.expectRevert(PoolVault.TooEarly.selector);
        v.prefetch(account);

        vm.warp(block.timestamp + Y - 30 days);
        v.prefetch(account);
        assertEq(mor.balanceOf(address(v)), 100e18);
        builders.setBroken(true); // Morpheus can fail now: the stake is already back
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        v.withdraw(id);
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function test_laterStakesCannotLockAnEarlierPosition() public {
        BuilderVault v = _create();
        uint256 a = _stake(v, alice, 100e18, 0);
        vm.warp(block.timestamp + 150 days);
        uint256 b = _stake(v, bob, 1e18, 0); // new epoch, new account, new withdraw lock
        assertTrue(v.position(a).account != v.position(b).account);
        vm.warp(v.position(a).end);
        vm.prank(alice);
        v.withdraw(a);
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function test_morpheusFailureBecomesExitPendingThenRetries() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 100e18, 0);
        vm.warp(block.timestamp + Y);
        builders.setBroken(true);
        vm.prank(alice);
        v.withdraw(id);
        assertEq(uint8(v.position(id).status), uint8(PoolVault.Status.ExitPending));
        assertEq(mor.balanceOf(alice), 0);
        assertGt(og.balanceOf(alice), 0);

        builders.setBroken(false);
        v.processExit(id); // anyone
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function test_subnetMorOnlyGoesToSplitterAndSplits() public {
        BuilderVault v = _create();
        _stake(v, alice, 100e18, 0);
        builders.accrue(v.subnetId(), 1_000e18);
        assertEq(v.pendingSubnetMor(), 1_000e18);

        vm.prank(bob); // anyone can trigger
        v.claimSubnetMor();
        address receiver = v.morReceiver();
        assertEq(mor.balanceOf(receiver), 1_000e18);
        assertEq(mor.balanceOf(bob), 0);

        bytes32 salt = factory.poolSalt(address(v));
        address splitter = splitterDeployer.deploySplitter(salt, partner);
        assertEq(splitter, receiver);
        MorSplitter(splitter).distribute();
        assertEq(mor.balanceOf(feeWallet), 100e18);
        assertEq(mor.balanceOf(partner), 900e18);
    }

    function test_perAccountClaimIsDisabled() public {
        BuilderVault v = _create();
        vm.expectRevert(BuilderVault.UseSubnetClaim.selector);
        v.claimMor(0, 0, 0);
    }

    function test_directSubnetClaimByPartnerIsImpossible() public {
        BuilderVault v = _create();
        builders.accrue(v.subnetId(), 1e18);
        bytes32 id = v.subnetId();
        vm.prank(partner);
        vm.expectRevert(bytes("BU: invalid caller"));
        builders.claim(id, partner);
    }

    function test_onlyPartnerEditsListing() public {
        BuilderVault v = _create();
        IBuildersV4.SubnetMetadata memory m = IBuildersV4.SubnetMetadata("new", "New", "https://new.example", "img");
        vm.expectRevert(PoolVault.NotPartner.selector);
        v.editSubnetMetadata(m);
        vm.prank(partner);
        v.editSubnetMetadata(m);
        assertEq(builders.metadata(v.subnetId()).website, "https://new.example");
    }

    function test_circuitBreakerStopsStakesNotExits() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 100e18, 0);
        builders.setVersion(5);
        assertFalse(adapter.isHealthy(address(builders)));

        mor.mint(bob, 10e18);
        vm.startPrank(bob);
        mor.approve(address(v), 10e18);
        vm.expectRevert(PoolVault.DepositsHalted.selector);
        v.stake(0, 0, 10e18, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + Y);
        vm.prank(alice);
        v.withdraw(id);
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function test_exitAdapterStillWithdraws() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 100e18, 0);
        vm.prank(guardian);
        factory.useExitAdapter();

        mor.mint(bob, 10e18);
        vm.startPrank(bob);
        mor.approve(address(v), 10e18);
        vm.expectRevert(PoolVault.DepositsHalted.selector);
        v.stake(0, 0, 10e18, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + Y);
        vm.prank(alice);
        v.withdraw(id);
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function test_emergencyExitWaitsForWithdrawLockThenFarmerLeavesEarly() public {
        BuilderVault v = _create();
        uint256 id = _stake(v, alice, 100e18, 0);
        address account = v.position(id).account;
        vm.prank(guardian);
        vm.expectRevert(); // inside Morpheus's 7-day withdraw lock
        v.emergencyExit(account);

        vm.warp(block.timestamp + 8 days);
        vm.prank(guardian);
        v.emergencyExit(account);
        vm.prank(alice);
        v.exitEarly(id);
        assertEq(mor.balanceOf(alice), 100e18);
    }

    function _ids(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }
}
