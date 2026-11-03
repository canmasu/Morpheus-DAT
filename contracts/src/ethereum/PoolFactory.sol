// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPoolTypes} from "../interfaces/IPoolTypes.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
import {IMorpheusAdapter} from "../interfaces/IMorpheusAdapter.sol";
import {PoolVault} from "./PoolVault.sol";

/// @title PoolFactory
/// @notice Creates Morpheus DAT pools and holds the protocol settings they read.
/// @dev No role can move contributor principal or reserved rewards.
contract PoolFactory is IPoolFactory, IPoolTypes, AccessControl, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant FEATURER_ROLE = keccak256("FEATURER_ROLE");

    uint16 public constant FEE_CAP_BPS = 2000;
    uint256 public constant TIMELOCK = 48 hours;

    address public immutable poolVaultImpl;
    address public immutable capitalAccountImpl;
    IMorpheusAdapter public immutable exitAdapter;

    /// @notice Arbitrum SplitterDeployer and MorSplitter implementation, used to predict each pool's MOR receiver.
    address public immutable splitterDeployer;
    address public immutable splitterImpl;

    IMorpheusAdapter public adapter;
    IMorpheusAdapter public pendingAdapter;
    uint256 public pendingAdapterEta;

    /// @notice Mirrors ArbFeeConfig for display; the fee itself is taken on Arbitrum.
    uint16 public feeBps;
    uint16 public pendingFeeBps;
    uint256 public pendingFeeEta;
    address public feeWallet;
    address public referralAddress;

    bool public depositsPaused;
    bool public allPaused;

    mapping(address stakeToken => address depositPool) public depositPoolOf;

    address[] internal _pools;
    mapping(address => bool) public isPool;
    mapping(address => bool) public featured;
    mapping(address => address) public poolPartner;

    event PoolCreated(address indexed vault, address indexed partner, address rewardToken, address morReceiver, bytes32 configHash);
    event FeeQueued(uint16 bps, uint256 eta);
    event FeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeWalletUpdated(address wallet);
    event ReferralAddressUpdated(address referral);
    event FeaturedSet(address indexed vault, bool isFeatured);
    event Paused(uint8 scope);
    event Unpaused();
    event AdapterQueued(address adapter, uint256 eta);
    event AdapterUpdated(address oldAdapter, address newAdapter);
    event StakeTokenSet(address stakeToken, address depositPool);

    error FeeTooHigh();
    error TimelockActive();
    error NothingQueued();
    error NotAPool();
    error ZeroAddress();
    error FundingMismatch();

    /// @dev scope for `pause`
    uint8 public constant PAUSE_DEPOSITS = 1;
    uint8 public constant PAUSE_ALL = 2;

    struct InitParams {
        address admin;
        address poolVaultImpl;
        address capitalAccountImpl;
        address adapter;
        address exitAdapter;
        address splitterDeployer;
        address splitterImpl;
        address feeWallet;
        address referralAddress;
        uint16 feeBps;
        address[] stakeTokens;
        address[] depositPools;
    }

    constructor(InitParams memory p) {
        if (p.admin == address(0) || p.feeWallet == address(0) || p.adapter == address(0)) revert ZeroAddress();
        if (p.feeBps > FEE_CAP_BPS) revert FeeTooHigh();
        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
        poolVaultImpl = p.poolVaultImpl;
        capitalAccountImpl = p.capitalAccountImpl;
        adapter = IMorpheusAdapter(p.adapter);
        exitAdapter = IMorpheusAdapter(p.exitAdapter);
        splitterDeployer = p.splitterDeployer;
        splitterImpl = p.splitterImpl;
        feeWallet = p.feeWallet;
        referralAddress = p.referralAddress;
        feeBps = p.feeBps;
        for (uint256 i; i < p.stakeTokens.length; ++i) {
            depositPoolOf[p.stakeTokens[i]] = p.depositPools[i];
            emit StakeTokenSet(p.stakeTokens[i], p.depositPools[i]);
        }
    }

    // ---------------------------------------------------------------- Partners

    /// @notice Permissionless. The caller becomes the pool's Partner and funds `initialBudget` reward tokens.
    function createPool(PoolConfig calldata cfg, uint256 initialBudget)
        external
        virtual
        nonReentrant
        returns (address vault)
    {
        return _createPool(cfg, initialBudget);
    }

    function _createPool(PoolConfig calldata cfg, uint256 initialBudget) internal returns (address vault) {
        if (cfg.depositStart < block.timestamp || cfg.depositEnd <= cfg.depositStart || cfg.epochLength == 0) {
            revert PoolVault.InvalidConfig();
        }
        vault = Clones.clone(poolVaultImpl);
        address morReceiver = predictSplitter(vault, msg.sender);

        uint256 funded;
        if (initialBudget > 0) {
            IERC20 reward = IERC20(cfg.rewardToken);
            uint256 before = reward.balanceOf(vault);
            reward.safeTransferFrom(msg.sender, vault, initialBudget);
            funded = reward.balanceOf(vault) - before;
            // Fee-on-transfer and similar reward tokens are rejected.
            if (funded != initialBudget) revert FundingMismatch();
        }
        PoolVault(vault).initialize(cfg, msg.sender, morReceiver, capitalAccountImpl, funded);

        _pools.push(vault);
        isPool[vault] = true;
        poolPartner[vault] = msg.sender;
        emit PoolCreated(vault, msg.sender, cfg.rewardToken, morReceiver, keccak256(abi.encode(cfg)));
    }

    /// @notice Salt shared with the Arbitrum SplitterDeployer: one splitter per (chain, vault).
    function poolSalt(address vault) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, vault));
    }

    /// @notice Address `SplitterDeployer.deploySplitter(poolSalt(vault), partner)` will deploy to on Arbitrum.
    function predictSplitter(address vault, address partner) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(poolSalt(vault), partner));
        return Clones.predictDeterministicAddress(splitterImpl, salt, splitterDeployer);
    }

    // ---------------------------------------------------------------- Admin

    function queueFee(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > FEE_CAP_BPS) revert FeeTooHigh();
        pendingFeeBps = bps;
        pendingFeeEta = block.timestamp + TIMELOCK;
        emit FeeQueued(bps, pendingFeeEta);
    }

    /// @notice Anyone can apply a queued fee once its timelock has passed.
    function applyFee() external {
        if (pendingFeeEta == 0) revert NothingQueued();
        if (block.timestamp < pendingFeeEta) revert TimelockActive();
        emit FeeUpdated(feeBps, pendingFeeBps);
        feeBps = pendingFeeBps;
        pendingFeeEta = 0;
    }

    function setFeeWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        feeWallet = wallet;
        emit FeeWalletUpdated(wallet);
    }

    /// @notice Applies to stakes made after the change (Morpheus keeps an existing referrer when given 0x0).
    function setReferralAddress(address referral) external onlyRole(DEFAULT_ADMIN_ROLE) {
        referralAddress = referral;
        emit ReferralAddressUpdated(referral);
    }

    /// @notice Adds or changes a stake asset for pools created from now on.
    function setStakeToken(address stakeToken, address depositPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositPoolOf[stakeToken] = depositPool;
        emit StakeTokenSet(stakeToken, depositPool);
    }

    function setFeatured(address vault, bool isFeatured) external onlyRole(FEATURER_ROLE) {
        if (!isPool[vault]) revert NotAPool();
        featured[vault] = isFeatured;
        emit FeaturedSet(vault, isFeatured);
    }

    /// @notice PAUSE_DEPOSITS: pauser role. PAUSE_ALL (everything except unlocked principal): guardian role.
    function pause(uint8 scope) external {
        if (scope == PAUSE_DEPOSITS) {
            _checkRole(PAUSER_ROLE);
            depositsPaused = true;
        } else {
            _checkRole(GUARDIAN_ROLE);
            depositsPaused = true;
            allPaused = true;
        }
        emit Paused(scope);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositsPaused = false;
        allPaused = false;
        emit Unpaused();
    }

    function queueAdapter(address newAdapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newAdapter == address(0)) revert ZeroAddress();
        pendingAdapter = IMorpheusAdapter(newAdapter);
        pendingAdapterEta = block.timestamp + TIMELOCK;
        emit AdapterQueued(newAdapter, pendingAdapterEta);
    }

    function applyAdapter() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingAdapterEta == 0) revert NothingQueued();
        if (block.timestamp < pendingAdapterEta) revert TimelockActive();
        emit AdapterUpdated(address(adapter), address(pendingAdapter));
        adapter = pendingAdapter;
        pendingAdapter = IMorpheusAdapter(address(0));
        pendingAdapterEta = 0;
    }

    /// @notice Instant switch to the pre-audited exit-only adapter. Safe without a timelock because it can
    /// only withdraw, and principal can only return to its own vault.
    function useExitAdapter() external onlyRole(GUARDIAN_ROLE) {
        emit AdapterUpdated(address(adapter), address(exitAdapter));
        adapter = exitAdapter;
    }

    // ---------------------------------------------------------------- Views

    function isGuardian(address account) external view returns (bool) {
        return hasRole(GUARDIAN_ROLE, account);
    }

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }

    function getPools(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = _pools.length;
        if (offset >= n) return page;
        uint256 end = offset + limit > n ? n : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _pools[i];
        }
    }

    function featuredPools() external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i; i < _pools.length; ++i) {
            if (featured[_pools[i]]) ++n;
        }
        out = new address[](n);
        n = 0;
        for (uint256 i; i < _pools.length; ++i) {
            if (featured[_pools[i]]) out[n++] = _pools[i];
        }
    }
}
