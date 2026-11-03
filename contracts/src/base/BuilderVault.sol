// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBuildersV4} from "../interfaces/IBuildersV4.sol";
import {PoolVault} from "../ethereum/PoolVault.sol";

/// @title BuilderVault
/// @notice A PoolVault on Base: Farmers stake MOR into this pool's own Morpheus Builders Subnet and earn OG Tokens;
/// the Subnet's MOR goes to the pool's MorSplitter (DAT fee + Partner).
/// @dev This vault is the Subnet's `admin` and `claimAdmin` for life and has no call to `editSubnet`, so nobody can
/// redirect the MOR or raise the withdraw lock on Farmers' stake.
contract BuilderVault is PoolVault {
    using SafeERC20 for IERC20;

    IBuildersV4 public builders;
    bytes32 public subnetId;

    event SubnetCreated(bytes32 indexed subnetId, string name);
    event SubnetMetadataEdited(bytes32 indexed subnetId);
    event SubnetMorClaimed(bytes32 indexed subnetId, address indexed caller, address receiver);

    error NotFactory();
    error SubnetAlreadySet();
    error UseSubnetClaim();

    /// @notice Called by BuilderPoolFactory in the pool's creation transaction, after moving any Morpheus creation
    /// fee here. The withdraw lock must end inside the pre-fetch window, so stake is back before any unlock.
    function setupSubnet(string calldata name, IBuildersV4.SubnetMetadata calldata metadata) external {
        if (msg.sender != address(factory)) revert NotFactory();
        if (subnetId != bytes32(0)) revert SubnetAlreadySet();
        if (_sleeves.length != 1) revert InvalidConfig();

        IBuildersV4 b = IBuildersV4(_sleeves[0].depositPool);
        IERC20 mor = _sleeves[0].stakeToken;
        if (b.depositToken() != address(mor)) revert InvalidConfig();
        uint256 lock = b.minimalWithdrawLockPeriod();
        if (lock > PREFETCH_WINDOW) revert InvalidConfig();

        builders = b;
        subnetId = b.getSubnetId(name);

        uint256 fee = b.subnetCreationFeeAmount();
        if (fee > 0) mor.forceApprove(address(b), fee);
        b.createSubnet(
            IBuildersV4.Subnet({
                name: name,
                admin: address(this),
                unusedStorage1_V4Update: 0,
                withdrawLockPeriodAfterDeposit: uint128(lock),
                unusedStorage2_V4Update: 0,
                minimalDeposit: 0,
                claimAdmin: address(this)
            }),
            metadata
        );
        if (fee > 0) mor.forceApprove(address(b), 0);
        emit SubnetCreated(subnetId, name);
    }

    /// @notice Claims the Subnet's MOR. Anyone can call; MOR only ever goes to the pool's splitter.
    function claimSubnetMor() external nonReentrant notAllPaused {
        builders.claim(subnetId, morReceiver);
        emit SubnetMorClaimed(subnetId, msg.sender, morReceiver);
    }

    /// @dev Builders rewards belong to the Subnet, not to single accounts.
    function claimMor(uint256, uint256, uint256) external payable override {
        revert UseSubnetClaim();
    }

    /// @notice The Partner's listing on the Morpheus dashboard (description, website, logo).
    function editSubnetMetadata(IBuildersV4.SubnetMetadata calldata metadata) external onlyPartner {
        builders.editSubnetMetadata(subnetId, metadata);
        emit SubnetMetadataEdited(subnetId);
    }

    /// @notice MOR the Subnet has earned and not claimed yet.
    function pendingSubnetMor() external view returns (uint256) {
        return builders.getCurrentSubnetRewards(subnetId);
    }
}
