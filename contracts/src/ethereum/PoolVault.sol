// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolTypes} from "../interfaces/IPoolTypes.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
import {IMorpheusAdapter} from "../interfaces/IMorpheusAdapter.sol";
import {CapitalAccount} from "./CapitalAccount.sol";

/// @title PoolVault
/// @notice One Partner's pool. Contributors stake USDC or stETH, keep their principal and earn the Partner Token;
/// the principal's Morpheus yield earns MOR for the Partner on Arbitrum.
/// @dev Safety rules (see docs/proposal.md, "Principal safety"):
///  1. Reward claims never touch Morpheus.
///  3. This contract's ledger is the source of truth for principal.
///  4. Accounts are pulled out of Morpheus `PREFETCH_WINDOW` before their earliest unlock.
///  5. `withdraw` never reverts on a Morpheus failure; the position becomes ExitPending instead.
///  8. Unlocked principal can always be withdrawn, even when everything else is paused.
contract PoolVault is IPoolTypes, Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant PREFETCH_WINDOW = 30 days;
    /// @dev Below this, an account counts as fully out of Morpheus (stETH share rounding leaves a few wei).
    uint256 internal constant MORPHEUS_DUST = 10;

    enum Status {
        Active,
        ExitPending,
        Withdrawn
    }

    struct Sleeve {
        IERC20 stakeToken;
        address depositPool;
        uint256 unit;
        uint256 ratePerUnit;
        uint256 cap;
        uint256 totalStaked; // active principal (ledger), in Morpheus or in this vault
        uint256 principalHeld; // part of totalStaked already pulled back into this vault
    }

    struct Position {
        address owner;
        uint8 sleeveId;
        uint8 tierId;
        uint8 lockOptionId;
        Status status;
        uint64 start;
        uint64 end;
        address account;
        uint256 amount;
        uint256 reward;
        uint256 claimed;
    }

    struct AccountInfo {
        bool exists;
        bool inMorpheus;
        bool emergency;
        uint8 sleeveId;
        uint8 lockOptionId;
        uint32 epochId;
        uint256 principal; // active principal of positions in this account
    }

    IPoolFactory public factory;
    address public partner;
    IERC20 public rewardToken;
    address public morReceiver;
    address public capitalAccountImpl;

    uint64 public depositStart;
    uint64 public depositEnd;
    uint64 public epochLength;
    bool public morBoost;

    Sleeve[] internal _sleeves;
    mapping(uint256 sleeveId => Tier[]) internal _tiers;
    LockOption[] internal _lockOptions;

    uint256 public funded;
    uint256 public partnerWithdrawn;
    uint256 public committed;
    uint256 public paid;

    Position[] internal _positions;
    mapping(address owner => uint256[]) internal _positionsOf;
    mapping(address owner => mapping(uint256 sleeveId => mapping(uint256 tierId => uint256))) public stakedBy;

    mapping(bytes32 key => address) internal _accountOf;
    mapping(address account => AccountInfo) public accountInfo;
    address[] public accounts;

    event Staked(
        uint256 indexed positionId,
        address indexed owner,
        uint256 sleeveId,
        uint256 amount,
        uint256 tierId,
        uint256 lockOptionId,
        uint256 end,
        uint256 reward,
        address account
    );
    event RewardClaimed(uint256 indexed positionId, address indexed owner, uint256 amount);
    event Withdrawn(uint256 indexed positionId, address indexed owner, uint256 amount);
    event ExitPending(uint256 indexed positionId, address indexed account);
    event ExitedEarly(uint256 indexed positionId, uint256 forfeitedReward);
    event RewardsFunded(address indexed from, uint256 amount);
    event UnreservedWithdrawn(uint256 amount);
    event MorClaimTriggered(address indexed account, address indexed caller);
    event AccountCreated(uint256 sleeveId, uint256 epochId, uint256 lockOptionId, address account);
    event AccountPulled(address indexed account, uint256 received, uint256 recorded);
    event AccountPartlyPulled(address indexed account, uint256 received, uint256 stillInMorpheus);
    event ExitStillPending(uint256 indexed positionId, uint256 stillInMorpheus);
    event EmergencyExit(address indexed account, address indexed guardian);
    event DatesUpdated(uint64 depositStart, uint64 depositEnd);
    event SurplusSwept(uint256 sleeveId, address to, uint256 amount);

    error NotPartner();
    error NotOwner();
    error NotGuardian();
    error Paused();
    error DepositsClosed();
    error DepositsHalted();
    error InvalidConfig();
    error InvalidTier();
    error InvalidLockOption();
    error WalletLimit();
    error CapExceeded();
    error InsufficientBudget();
    error ZeroReward();
    error BadStatus();
    error StillLocked();
    error TooEarly();
    error NotInMorpheus();
    error NotEmergency();
    error AccountClosed();
    error TransferMismatch();
    error SleeveActive();

    modifier onlyPartner() {
        if (msg.sender != partner) revert NotPartner();
        _;
    }

    modifier notAllPaused() {
        if (factory.allPaused()) revert Paused();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @dev Called by PoolFactory right after it moved `fundedAmount` reward tokens here.
    function initialize(
        PoolConfig calldata cfg,
        address partner_,
        address morReceiver_,
        address capitalAccountImpl_,
        uint256 fundedAmount
    ) external initializer {
        factory = IPoolFactory(msg.sender);
        partner = partner_;
        rewardToken = IERC20(cfg.rewardToken);
        morReceiver = morReceiver_;
        capitalAccountImpl = capitalAccountImpl_;
        depositStart = cfg.depositStart;
        depositEnd = cfg.depositEnd;
        epochLength = cfg.epochLength;
        morBoost = cfg.morBoost;
        funded = fundedAmount;

        if (cfg.lockOptions.length == 0 || cfg.lockOptions.length > type(uint8).max) revert InvalidLockOption();
        for (uint256 i; i < cfg.lockOptions.length; ++i) {
            LockOption calldata lo = cfg.lockOptions[i];
            // The account must close (epoch end) before its pre-fetch window opens.
            if (lo.duration < cfg.epochLength + PREFETCH_WINDOW || lo.multBps == 0) revert InvalidLockOption();
            _lockOptions.push(lo);
        }

        if (cfg.sleeves.length == 0 || cfg.sleeves.length > type(uint8).max) revert InvalidConfig();
        for (uint256 s; s < cfg.sleeves.length; ++s) {
            _initSleeve(s, cfg.sleeves[s], cfg.rewardToken, cfg.lockOptions.length);
        }
    }

    function _initSleeve(uint256 s, SleeveConfig calldata sc, address rewardToken_, uint256 lockCount) internal {
        address dp = factory.depositPoolOf(sc.stakeToken);
        if (dp == address(0) || sc.stakeToken == rewardToken_ || sc.unit == 0 || sc.ratePerUnit == 0 || sc.cap == 0) {
            revert InvalidConfig();
        }
        for (uint256 j; j < s; ++j) {
            if (address(_sleeves[j].stakeToken) == sc.stakeToken) revert InvalidConfig();
        }
        _sleeves.push(Sleeve(IERC20(sc.stakeToken), dp, sc.unit, sc.ratePerUnit, sc.cap, 0, 0));

        if (sc.tiers.length == 0 || sc.tiers.length > type(uint8).max) revert InvalidTier();
        for (uint256 t; t < sc.tiers.length; ++t) {
            Tier calldata tc = sc.tiers[t];
            if (tc.kind == TierKind.FIXED || tc.kind == TierKind.BRACKET) {
                if (tc.amounts.length == 0 || tc.amounts.length != tc.multBps.length || tc.lockOptionId >= lockCount) {
                    revert InvalidTier();
                }
                for (uint256 i; i < tc.multBps.length; ++i) {
                    if (tc.multBps[i] == 0) revert InvalidTier();
                    if (tc.kind == TierKind.BRACKET && i > 0 && tc.amounts[i] <= tc.amounts[i - 1]) revert InvalidTier();
                }
                if (tc.kind == TierKind.BRACKET && tc.maxPerWallet != 0 && tc.maxPerWallet < tc.amounts[0]) revert InvalidTier();
            } else if (tc.maxPerWallet != 0 && tc.maxPerWallet < tc.minPerWallet) {
                revert InvalidTier();
            }
            Tier storage nt = _tiers[s].push();
            nt.kind = tc.kind;
            nt.minPerWallet = tc.minPerWallet;
            nt.maxPerWallet = tc.maxPerWallet;
            nt.amounts = tc.amounts;
            nt.multBps = tc.multBps;
            nt.lockOptionId = tc.lockOptionId;
        }
    }

    // ---------------------------------------------------------------- Contributor

    /// @notice Stakes into the pool. For a FIXED tier `amountOrIndex` is the index into the tier's amounts.
    function stake(uint256 sleeveId, uint256 tierId, uint256 amountOrIndex, uint256 lockOptionId)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (factory.depositsPaused() || factory.allPaused()) revert Paused();
        if (block.timestamp < depositStart || block.timestamp >= depositEnd) revert DepositsClosed();
        Sleeve storage s = _sleeves[sleeveId];
        IMorpheusAdapter adapter = factory.adapter();
        if (adapter.isExitOnly() || !adapter.isHealthy(s.depositPool)) revert DepositsHalted();

        (uint256 nominal, uint256 lockId, uint256 multBps) = _resolveTier(sleeveId, tierId, amountOrIndex, lockOptionId);

        uint256 before = s.stakeToken.balanceOf(address(this));
        s.stakeToken.safeTransferFrom(msg.sender, address(this), nominal);
        uint256 amount = s.stakeToken.balanceOf(address(this)) - before;

        if (s.totalStaked + amount > s.cap) revert CapExceeded();
        uint256 duration = _lockOptions[lockId].duration;
        uint256 reward = _reward(s, amount, multBps, duration);
        if (reward == 0) revert ZeroReward();
        if (reward > available()) revert InsufficientBudget();

        committed += reward;
        s.totalStaked += amount;
        stakedBy[msg.sender][sleeveId][tierId] += amount;

        address account = _routeToAccount(sleeveId, lockId, amount);

        positionId = _positions.length;
        _positions.push(
            Position({
                owner: msg.sender,
                sleeveId: uint8(sleeveId),
                tierId: uint8(tierId),
                lockOptionId: uint8(lockId),
                status: Status.Active,
                start: uint64(block.timestamp),
                end: uint64(block.timestamp + duration),
                account: account,
                amount: amount,
                reward: reward,
                claimed: 0
            })
        );
        _positionsOf[msg.sender].push(positionId);
        emit Staked(
            positionId, msg.sender, sleeveId, amount, tierId, lockId, block.timestamp + duration, reward, account
        );
    }

    /// @notice Exact reward the contributor will receive, shown before confirming.
    function quote(uint256 sleeveId, uint256 tierId, uint256 amountOrIndex, uint256 lockOptionId)
        external
        view
        returns (uint256)
    {
        (uint256 nominal, uint256 lockId, uint256 multBps) = _resolveTierView(sleeveId, tierId, amountOrIndex, lockOptionId);
        return _reward(_sleeves[sleeveId], nominal, multBps, _lockOptions[lockId].duration);
    }

    function claimReward(uint256[] calldata positionIds) external nonReentrant notAllPaused {
        uint256 total;
        for (uint256 i; i < positionIds.length; ++i) {
            Position storage p = _positions[positionIds[i]];
            if (p.owner != msg.sender) revert NotOwner();
            uint256 amt = _accrued(p);
            if (amt == 0) continue;
            p.claimed += amt;
            total += amt;
            emit RewardClaimed(positionIds[i], msg.sender, amt);
        }
        paid += total;
        if (total > 0) rewardToken.safeTransfer(msg.sender, total);
    }

    /// @notice Returns principal plus any unclaimed reward after unlock. Never paused, never reverts on Morpheus.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = _positions[positionId];
        if (p.owner != msg.sender) revert NotOwner();
        if (p.status != Status.Active) revert BadStatus();
        if (block.timestamp < p.end) revert StillLocked();

        if (accountInfo[p.account].inMorpheus && !_pull(p.account, false)) {
            p.status = Status.ExitPending;
            _payReward(positionId, p);
            emit ExitPending(positionId, p.account);
            return;
        }
        _payout(positionId, p);
    }

    /// @notice Retries an ExitPending withdrawal. Anyone can call; funds only go to the position owner.
    /// If Morpheus hands back only part of the account (e.g. a per-call cap), each call pulls another part and
    /// the owner is paid once all of it is back.
    function processExit(uint256 positionId) external nonReentrant {
        Position storage p = _positions[positionId];
        if (p.status != Status.ExitPending) revert BadStatus();
        if (accountInfo[p.account].inMorpheus && !_pull(p.account, true)) {
            emit ExitStillPending(positionId, _morpheusBalance(p.account));
            return;
        }
        _payout(positionId, p);
    }

    /// @notice After an emergency exit, a contributor may leave before unlock and keep only the reward accrued
    /// so far (open decision 17). The unearned part returns to the Partner's unreserved budget.
    function exitEarly(uint256 positionId) external nonReentrant {
        Position storage p = _positions[positionId];
        if (p.owner != msg.sender) revert NotOwner();
        if (p.status != Status.Active) revert BadStatus();
        AccountInfo storage info = accountInfo[p.account];
        if (!info.emergency || info.inMorpheus) revert NotEmergency();
        if (block.timestamp < p.end) {
            uint256 vested = Math.mulDiv(p.reward, block.timestamp - p.start, p.end - p.start);
            uint256 forfeited = p.reward - vested;
            p.reward = vested;
            p.end = uint64(block.timestamp);
            committed -= forfeited;
            emit ExitedEarly(positionId, forfeited);
        }
        _payout(positionId, p);
    }

    // ---------------------------------------------------------------- Keepers / anyone

    /// @notice Pulls an account's principal out of Morpheus once its pre-fetch window opens.
    function prefetch(address account) external nonReentrant {
        AccountInfo storage info = accountInfo[account];
        if (!info.inMorpheus) revert NotInMorpheus();
        (uint256 epochEnd, uint256 earliestUnlock) = _accountTimes(info.epochId, info.lockOptionId);
        if (block.timestamp < epochEnd || block.timestamp + PREFETCH_WINDOW < earliestUnlock) revert TooEarly();
        _pull(account, true);
    }

    /// @notice Triggers a MOR claim for one account. `msg.value` pays LayerZero; the refund goes to the caller.
    function claimMor(uint256 sleeveId, uint256 epochId, uint256 lockOptionId) external payable nonReentrant notAllPaused {
        address account = _accountOf[_key(sleeveId, epochId, lockOptionId)];
        if (account == address(0) || !accountInfo[account].inMorpheus) revert NotInMorpheus();
        CapitalAccount(payable(account)).claim{value: msg.value}(msg.sender);
        emit MorClaimTriggered(account, msg.sender);
    }

    // ---------------------------------------------------------------- Guardian

    /// @notice Pulls all of an account's principal from Morpheus now. Positions keep their lock and rewards.
    function emergencyExit(address account) external nonReentrant {
        if (!factory.isGuardian(msg.sender)) revert NotGuardian();
        AccountInfo storage info = accountInfo[account];
        if (!info.inMorpheus) revert NotInMorpheus();
        info.emergency = true;
        _pull(account, true);
        emit EmergencyExit(account, msg.sender);
    }

    // ---------------------------------------------------------------- Partner

    function fundRewards(uint256 amount) external nonReentrant onlyPartner {
        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        if (rewardToken.balanceOf(address(this)) - before != amount) revert TransferMismatch();
        funded += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    /// @notice Withdraws budget no position has reserved, only after deposits close.
    function withdrawUnreserved(uint256 amount) external nonReentrant onlyPartner {
        if (block.timestamp < depositEnd) revert DepositsClosed();
        if (amount > available()) revert InsufficientBudget();
        partnerWithdrawn += amount;
        rewardToken.safeTransfer(msg.sender, amount);
        emit UnreservedWithdrawn(amount);
    }

    /// @notice Before deposits open both dates can change; afterwards `depositEnd` can only be extended.
    function setDates(uint64 newStart, uint64 newEnd) external onlyPartner {
        if (newStart >= newEnd) revert InvalidConfig();
        if (block.timestamp < depositStart) {
            if (newStart < block.timestamp) revert InvalidConfig();
            depositStart = newStart;
        } else if (newStart != depositStart || newEnd < depositEnd) {
            revert InvalidConfig();
        }
        depositEnd = newEnd;
        emit DatesUpdated(depositStart, newEnd);
    }

    /// @notice Sends what is left in a fully exited sleeve (stETH rebase, unused dust reserve) to the DAT fee wallet.
    function sweepSurplus(uint256 sleeveId) external nonReentrant {
        Sleeve storage s = _sleeves[sleeveId];
        if (block.timestamp < depositEnd || s.totalStaked != 0) revert SleeveActive();
        uint256 bal = s.stakeToken.balanceOf(address(this));
        address to = factory.feeWallet();
        if (bal > 0) s.stakeToken.safeTransfer(to, bal);
        emit SurplusSwept(sleeveId, to, bal);
    }

    // ---------------------------------------------------------------- Views

    function available() public view returns (uint256) {
        return funded - partnerWithdrawn - committed;
    }

    function accrued(uint256 positionId) external view returns (uint256) {
        return _accrued(_positions[positionId]);
    }

    function position(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positionsByOwner(address owner) external view returns (uint256[] memory) {
        return _positionsOf[owner];
    }

    function sleeve(uint256 sleeveId) external view returns (Sleeve memory) {
        return _sleeves[sleeveId];
    }

    function sleeveCount() external view returns (uint256) {
        return _sleeves.length;
    }

    function tier(uint256 sleeveId, uint256 tierId) external view returns (Tier memory) {
        return _tiers[sleeveId][tierId];
    }

    function tierCount(uint256 sleeveId) external view returns (uint256) {
        return _tiers[sleeveId].length;
    }

    function lockOption(uint256 lockOptionId) external view returns (LockOption memory) {
        return _lockOptions[lockOptionId];
    }

    function lockOptionCount() external view returns (uint256) {
        return _lockOptions.length;
    }

    function accountCount() external view returns (uint256) {
        return accounts.length;
    }

    function accountOf(uint256 sleeveId, uint256 epochId, uint256 lockOptionId) external view returns (address) {
        return _accountOf[_key(sleeveId, epochId, lockOptionId)];
    }

    function currentEpoch() public view returns (uint256) {
        return block.timestamp < depositStart ? 0 : (block.timestamp - depositStart) / epochLength;
    }

    /// @return epochEnd when the account stops taking stakes
    /// @return earliestUnlock first possible position end in the account
    /// @return prefetchAt when `prefetch` becomes callable
    function accountTimes(address account)
        external
        view
        returns (uint256 epochEnd, uint256 earliestUnlock, uint256 prefetchAt)
    {
        AccountInfo storage info = accountInfo[account];
        (epochEnd, earliestUnlock) = _accountTimes(info.epochId, info.lockOptionId);
        prefetchAt = Math.max(epochEnd, earliestUnlock - PREFETCH_WINDOW);
    }

    // ---------------------------------------------------------------- Internal

    function _resolveTier(uint256 sleeveId, uint256 tierId, uint256 amountOrIndex, uint256 lockOptionId)
        internal
        view
        returns (uint256 amount, uint256 lockId, uint256 multBps)
    {
        (amount, lockId, multBps) = _resolveTierView(sleeveId, tierId, amountOrIndex, lockOptionId);
        Tier storage t = _tiers[sleeveId][tierId];
        if (t.kind == TierKind.RANGE) {
            if (amount < t.minPerWallet) revert WalletLimit();
            if (t.maxPerWallet != 0 && stakedBy[msg.sender][sleeveId][tierId] + amount > t.maxPerWallet) {
                revert WalletLimit();
            }
        }
    }

    function _resolveTierView(uint256 sleeveId, uint256 tierId, uint256 amountOrIndex, uint256 lockOptionId)
        internal
        view
        returns (uint256 amount, uint256 lockId, uint256 multBps)
    {
        if (tierId >= _tiers[sleeveId].length) revert InvalidTier();
        Tier storage t = _tiers[sleeveId][tierId];
        if (t.kind == TierKind.FIXED) {
            if (amountOrIndex >= t.amounts.length || lockOptionId != t.lockOptionId) revert InvalidTier();
            return (t.amounts[amountOrIndex], t.lockOptionId, t.multBps[amountOrIndex]);
        }
        if (t.kind == TierKind.BRACKET) {
            if (lockOptionId != t.lockOptionId) revert InvalidTier();
            if (amountOrIndex < t.amounts[0] || (t.maxPerWallet != 0 && amountOrIndex > t.maxPerWallet)) revert WalletLimit();
            uint256 i = t.amounts.length - 1;
            while (t.amounts[i] > amountOrIndex) --i;
            return (amountOrIndex, t.lockOptionId, t.multBps[i]);
        }
        if (lockOptionId >= _lockOptions.length) revert InvalidLockOption();
        return (amountOrIndex, lockOptionId, _lockOptions[lockOptionId].multBps);
    }

    /// @dev R = a * ratePerUnit * multBps * d / (unit * 10^4 * YEAR), rounded down.
    function _reward(Sleeve storage s, uint256 amount, uint256 multBps, uint256 duration)
        internal
        view
        returns (uint256)
    {
        return Math.mulDiv(amount, s.ratePerUnit * multBps * duration, s.unit * BPS * YEAR);
    }

    function _accrued(Position storage p) internal view returns (uint256) {
        uint256 t = Math.min(block.timestamp, p.end);
        if (t <= p.start) return 0;
        return Math.mulDiv(p.reward, t - p.start, p.end - p.start) - p.claimed;
    }

    function _routeToAccount(uint256 sleeveId, uint256 lockId, uint256 amount) internal returns (address account) {
        uint256 epochId = currentEpoch();
        bytes32 key = _key(sleeveId, epochId, lockId);
        account = _accountOf[key];
        Sleeve storage s = _sleeves[sleeveId];
        if (account == address(0)) {
            account = Clones.clone(capitalAccountImpl);
            CapitalAccount(payable(account)).initialize(
                address(this), address(factory), s.depositPool, address(s.stakeToken), morReceiver
            );
            _accountOf[key] = account;
            accountInfo[account] = AccountInfo({
                exists: true,
                inMorpheus: true,
                emergency: false,
                sleeveId: uint8(sleeveId),
                lockOptionId: uint8(lockId),
                epochId: uint32(epochId),
                principal: 0
            });
            accounts.push(account);
            emit AccountCreated(sleeveId, epochId, lockId, account);
        }
        AccountInfo storage info = accountInfo[account];
        if (!info.inMorpheus || info.emergency) revert AccountClosed();
        info.principal += amount;

        (, uint256 earliestUnlock) = _accountTimes(epochId, lockId);
        s.stakeToken.safeTransfer(account, amount);
        CapitalAccount(payable(account)).deposit(morBoost ? uint128(earliestUnlock) : 0, factory.referralAddress());
    }

    /// @notice Withdraws as much of the account as Morpheus releases. The account counts as out of Morpheus only
    /// once Morpheus reports (almost) nothing left for it, so a partial withdrawal never strands principal.
    /// @return done true once the account is fully out; false if Morpheus reverted (only when `mustSucceed` is
    /// false) or still holds part of it
    function _pull(address account, bool mustSucceed) internal returns (bool done) {
        AccountInfo storage info = accountInfo[account];
        Sleeve storage s = _sleeves[info.sleeveId];
        uint256 before = s.stakeToken.balanceOf(address(this));
        if (mustSucceed) {
            CapitalAccount(payable(account)).withdrawAll();
        } else {
            try CapitalAccount(payable(account)).withdrawAll() {}
            catch {
                return false;
            }
        }
        uint256 received = s.stakeToken.balanceOf(address(this)) - before;
        uint256 left = _morpheusBalance(account);
        if (left > MORPHEUS_DUST) {
            emit AccountPartlyPulled(account, received, left);
            return false;
        }
        info.inMorpheus = false;
        s.principalHeld += info.principal;
        emit AccountPulled(account, received, info.principal);
        return true;
    }

    /// @dev What Morpheus still records for the account. If the adapter's view breaks (e.g. after a Morpheus
    /// upgrade), the account is treated as empty rather than blocking exits forever.
    function _morpheusBalance(address account) internal view returns (uint256) {
        try factory.adapter().deposited(_sleeves[accountInfo[account].sleeveId].depositPool, account) returns (uint256 d) {
            return d;
        } catch {
            return 0;
        }
    }

    function _payout(uint256 positionId, Position storage p) internal {
        Sleeve storage s = _sleeves[p.sleeveId];
        uint256 amount = p.amount;
        // A shortfall (stETH slashing, unfunded dust reserve) is shared pro rata by everyone still in the vault.
        uint256 bal = s.stakeToken.balanceOf(address(this));
        uint256 out = bal < s.principalHeld ? Math.mulDiv(amount, bal, s.principalHeld) : amount;

        p.status = Status.Withdrawn;
        accountInfo[p.account].principal -= amount;
        s.totalStaked -= amount;
        s.principalHeld -= amount;
        stakedBy[p.owner][p.sleeveId][p.tierId] -= amount;

        _payReward(positionId, p);
        s.stakeToken.safeTransfer(p.owner, out);
        emit Withdrawn(positionId, p.owner, out);
    }

    function _payReward(uint256 positionId, Position storage p) internal {
        uint256 amt = _accrued(p);
        if (amt == 0) return;
        p.claimed += amt;
        paid += amt;
        rewardToken.safeTransfer(p.owner, amt);
        emit RewardClaimed(positionId, p.owner, amt);
    }

    function _accountTimes(uint256 epochId, uint256 lockId)
        internal
        view
        returns (uint256 epochEnd, uint256 earliestUnlock)
    {
        uint256 epochStart = depositStart + epochId * epochLength;
        epochEnd = epochStart + epochLength;
        earliestUnlock = epochStart + _lockOptions[lockId].duration;
    }

    function _key(uint256 sleeveId, uint256 epochId, uint256 lockId) internal pure returns (bytes32) {
        return keccak256(abi.encode(sleeveId, epochId, lockId));
    }
}
