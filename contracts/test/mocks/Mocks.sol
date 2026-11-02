// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IKycRegistry} from "../../src/interfaces/IKycRegistry.sol";

contract MockERC20 is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Like stETH: every transfer between two accounts arrives 1 wei short.
contract MockStETH is MockERC20 {
    constructor() MockERC20("Liquid staked Ether", "stETH", 18) {}

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            super._update(from, to, value - 1);
            super._update(from, address(0), 1);
        } else {
            super._update(from, to, value);
        }
    }

    /// @dev Simulates a positive rebase (or a slashing with `burn`).
    function rebase(address holder, uint256 amount, bool burn) external {
        if (burn) _burn(holder, amount);
        else _mint(holder, amount);
    }
}

/// @dev Takes a 1% fee on every transfer.
contract FeeOnTransferToken is MockERC20 {
    constructor() MockERC20("Fee token", "FOT", 18) {}

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract MockKycRegistry is IKycRegistry {
    mapping(address => bool) public isAllowed;

    function set(address a, bool ok) external {
        isAllowed[a] = ok;
    }
}

contract MockDistributor {
    address public depositPool;
    IERC20 public token;
    /// @dev Wei kept back on each withdraw, like Aave rounding.
    uint256 public shortfall;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function setDepositPool(address dp) external {
        depositPool = dp;
    }

    function setShortfall(uint256 s) external {
        shortfall = s;
    }

    function supply(uint256, address user, uint256 amount) external returns (uint256) {
        require(msg.sender == depositPool, "only pool");
        uint256 before = token.balanceOf(address(this));
        token.transferFrom(user, address(this), amount);
        return token.balanceOf(address(this)) - before;
    }

    function withdraw(uint256, address user, uint256 amount) external returns (uint256) {
        require(msg.sender == depositPool, "only pool");
        uint256 out = amount > shortfall ? amount - shortfall : 0;
        token.transfer(user, out);
        return amount;
    }
}

/// @dev Morpheus v7 DepositPool behaviour that DAT depends on: per-address locks reset by each stake,
/// claim locks, claimLockEnd, referrer, LayerZero fee with refund.
contract MockDepositPool {
    struct UserData {
        uint128 lastStake;
        uint256 deposited;
        uint256 rate;
        uint256 pendingRewards;
        uint128 claimLockStart;
        uint128 claimLockEnd;
        uint256 virtualDeposited;
        uint128 lastClaim;
        address referrer;
    }

    uint256 public version = 7;
    address public depositToken;
    MockDistributor public distributor;

    uint128 public withdrawLockPeriodAfterStake = 7 days;
    uint128 public claimLockPeriodAfterStake = 14 days;
    uint128 public claimLockPeriodAfterClaim = 14 days;
    uint256 public minimalStake;

    bool public broken;
    uint256 public constant MOR_PER_CLAIM = 5e18;

    mapping(address => mapping(uint256 => UserData)) public usersData;
    mapping(uint256 => mapping(address => address)) public claimReceiver;

    event ClaimSent(address indexed user, address indexed receiver, uint256 amount, uint256 fee);

    constructor(address token_, uint256 minimalStake_) {
        depositToken = token_;
        minimalStake = minimalStake_;
        distributor = new MockDistributor(token_);
        distributor.setDepositPool(address(this));
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function setVersion(uint256 v) external {
        version = v;
    }

    function setLocks(uint128 w, uint128 cs, uint128 cc, uint256 minStake) external {
        (withdrawLockPeriodAfterStake, claimLockPeriodAfterStake, claimLockPeriodAfterClaim, minimalStake) =
            (w, cs, cc, minStake);
    }

    function rewardPoolsProtocolDetails(uint256)
        external
        view
        returns (uint128, uint128, uint128, uint256, uint256)
    {
        return (withdrawLockPeriodAfterStake, claimLockPeriodAfterStake, claimLockPeriodAfterClaim, minimalStake, 0);
    }

    bool public noClaimReceiver;
    /// @dev Morpheus Sepolia releases at most a fixed amount per withdraw call (0 = no cap).
    uint256 public withdrawCap;

    function setWithdrawCap(uint256 cap) external {
        withdrawCap = cap;
    }

    /// @dev Morpheus Sepolia's DepositPool pulls stake tokens into itself instead of via the distributor.
    bool public pullsDirectly;

    function setPullsDirectly(bool b) external {
        pullsDirectly = b;
    }

    /// @dev Morpheus Sepolia's DepositPool has no setClaimReceiver.
    function setNoClaimReceiver(bool b) external {
        noClaimReceiver = b;
    }

    function setClaimReceiver(uint256 idx, address receiver) external {
        require(!noClaimReceiver);
        claimReceiver[idx][msg.sender] = receiver;
    }

    function stake(uint256 idx, uint256 amount, uint128 claimLockEnd, address referrer) external {
        require(!broken, "broken");
        UserData storage u = usersData[msg.sender][idx];
        if (claimLockEnd == 0) claimLockEnd = u.claimLockEnd > block.timestamp ? u.claimLockEnd : uint128(block.timestamp);
        require(claimLockEnd >= u.claimLockEnd, "DS: invalid claim lock end");
        if (referrer == address(0)) referrer = u.referrer;
        require(amount > 0, "DS: nothing to stake");
        if (pullsDirectly) IERC20(depositToken).transferFrom(msg.sender, address(this), amount);
        else amount = distributor.supply(idx, msg.sender, amount);
        require(u.deposited + amount >= minimalStake, "DS: amount too low");
        u.deposited += amount;
        u.lastStake = uint128(block.timestamp);
        u.claimLockStart = uint128(block.timestamp);
        u.claimLockEnd = claimLockEnd;
        u.referrer = referrer;
    }

    function withdraw(uint256 idx, uint256 amount) external {
        require(!broken, "broken");
        UserData storage u = usersData[msg.sender][idx];
        require(u.deposited > 0, "DS: user isn't staked");
        if (amount > u.deposited) amount = u.deposited;
        if (withdrawCap != 0 && amount > withdrawCap) amount = withdrawCap;
        require(block.timestamp > u.lastStake + withdrawLockPeriodAfterStake, "DS: pool withdraw is locked");
        uint256 left = u.deposited - amount;
        require(left >= minimalStake || left < 10, "DS: invalid withdraw amount");
        u.deposited = left;
        if (pullsDirectly) IERC20(depositToken).transfer(msg.sender, amount);
        else distributor.withdraw(idx, msg.sender, amount);
    }

    function claim(uint256 idx, address receiver) external payable {
        require(!broken, "broken");
        UserData storage u = usersData[msg.sender][idx];
        require(block.timestamp > u.lastStake + claimLockPeriodAfterStake, "DS: pool claim is locked (S)");
        require(block.timestamp > u.lastClaim + claimLockPeriodAfterClaim, "DS: pool claim is locked (C)");
        require(block.timestamp > u.claimLockEnd, "DS: user claim is locked");
        require(u.lastStake > 0 && u.lastClaim < block.timestamp, "DS: nothing to claim");
        u.lastClaim = uint128(block.timestamp);
        u.claimLockEnd = 0;
        emit ClaimSent(msg.sender, receiver, MOR_PER_CLAIM, msg.value / 2);
        // LayerZero refund to the caller, like L1SenderV2.
        (bool ok,) = msg.sender.call{value: msg.value / 2}("");
        require(ok, "refund failed");
    }

    function lockClaim(uint256 idx, uint128 claimLockEnd) external {
        UserData storage u = usersData[msg.sender][idx];
        require(claimLockEnd > u.claimLockEnd, "DS: invalid lock end value (2)");
        u.claimLockEnd = claimLockEnd;
    }

    function getLatestUserReward(uint256 idx, address user) external view returns (uint256) {
        return usersData[user][idx].deposited > 0 ? MOR_PER_CLAIM : 0;
    }
}
