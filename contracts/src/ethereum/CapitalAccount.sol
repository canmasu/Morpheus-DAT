// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IMorpheusAdapter} from "../interfaces/IMorpheusAdapter.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";

/// @title CapitalAccount
/// @notice One Morpheus depositor address per (stake asset x deposit epoch x lock option) of a PoolVault.
/// @dev Hard rules that no adapter can change:
///  - calls go only to this account's own DepositPool, fixed at initialization;
///  - stake tokens leave this contract only to Morpheus's distributor (exact allowance, reset after) or to `vault`.
contract CapitalAccount is Initializable {
    using SafeERC20 for IERC20;

    /// @dev Morpheus allows stETH balances to be off by a few wei.
    uint256 internal constant DUST = 10;

    address public vault;
    IPoolFactory public factory;
    address public depositPool;
    IERC20 public stakeToken;
    address public morReceiver;

    error NotVault();
    error StakeIncomplete(uint256 leftOver);
    error MorpheusCallFailed(bytes reason);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(address vault_, address factory_, address depositPool_, address stakeToken_, address morReceiver_)
        external
        initializer
    {
        vault = vault_;
        factory = IPoolFactory(factory_);
        depositPool = depositPool_;
        stakeToken = IERC20(stakeToken_);
        morReceiver = morReceiver_;
        // Lets a keeper use Morpheus `claimFor` while MOR still lands at the pool's splitter. Best effort:
        // some Morpheus deployments (e.g. Sepolia) lack it, and DAT's own claims name the receiver directly.
        try _adapter().encodeSetClaimReceiver(depositPool_, morReceiver_) returns (bytes memory data) {
            (bool ok,) = depositPool_.call(data);
            ok;
        } catch {}
    }

    /// @notice Stakes this account's whole stake-token balance into Morpheus.
    /// @dev Mainnet v7 pulls through the distributor, Morpheus Sepolia pulls into the DepositPool itself, so
    /// both get an exact allowance for the duration of the call only.
    function deposit(uint128 claimLockEnd, address referrer) external onlyVault returns (uint256 amount) {
        amount = stakeToken.balanceOf(address(this));
        (address spender, bytes memory data) = _adapter().encodeStake(depositPool, amount, claimLockEnd, referrer);
        stakeToken.forceApprove(spender, amount);
        if (spender != depositPool) stakeToken.forceApprove(depositPool, amount);
        _call(data, 0);
        stakeToken.forceApprove(spender, 0);
        if (spender != depositPool) stakeToken.forceApprove(depositPool, 0);
        uint256 left = stakeToken.balanceOf(address(this));
        if (left > DUST) revert StakeIncomplete(left);
    }

    /// @notice Withdraws everything from Morpheus and sends it to the vault.
    function withdrawAll() external onlyVault returns (uint256 received) {
        _call(_adapter().encodeWithdrawAll(depositPool), 0);
        received = stakeToken.balanceOf(address(this));
        stakeToken.safeTransfer(vault, received);
    }

    /// @notice Claims MOR to the Arbitrum splitter. `msg.value` pays LayerZero; any refund goes to `refundTo`.
    function claim(address refundTo) external payable onlyVault {
        _call(_adapter().encodeClaim(depositPool, morReceiver), msg.value);
        uint256 refund = address(this).balance;
        if (refund > 0) {
            // Best effort: a refund that cannot be delivered stays here and goes out with the next one.
            (bool ok,) = refundTo.call{value: refund}("");
            ok;
        }
    }

    function lockClaim(uint128 claimLockEnd) external onlyVault {
        _call(_adapter().encodeLockClaim(depositPool, claimLockEnd), 0);
    }

    /// @notice Sends any stake tokens sitting here (e.g. sent by mistake) to the vault. Anyone can call.
    function flush() external {
        uint256 bal = stakeToken.balanceOf(address(this));
        if (bal > 0) stakeToken.safeTransfer(vault, bal);
    }

    receive() external payable {}

    function _adapter() internal view returns (IMorpheusAdapter) {
        return factory.adapter();
    }

    function _call(bytes memory data, uint256 value) internal {
        (bool ok, bytes memory ret) = depositPool.call{value: value}(data);
        if (!ok) revert MorpheusCallFailed(ret);
    }
}
