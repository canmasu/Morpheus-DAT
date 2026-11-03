// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The parts of Morpheus BuildersV4 (Base) that DAT uses. Stakers earn nothing directly: a Subnet's MOR
/// grows with its total deposit and only its `admin` or `claimAdmin` can claim it.
interface IBuildersV4 {
    struct Subnet {
        string name;
        address admin;
        uint128 unusedStorage1_V4Update;
        uint128 withdrawLockPeriodAfterDeposit;
        uint128 unusedStorage2_V4Update;
        uint256 minimalDeposit;
        address claimAdmin;
    }

    struct SubnetMetadata {
        string slug;
        string description;
        string website;
        string image;
    }

    function createSubnet(Subnet calldata subnet, SubnetMetadata calldata metadata) external;
    function editSubnetMetadata(bytes32 subnetId, SubnetMetadata calldata metadata) external;
    function deposit(bytes32 subnetId, uint256 amount) external;
    function withdraw(bytes32 subnetId, uint256 amount) external;
    function claim(bytes32 subnetId, address receiver) external;

    function getSubnetId(string memory name) external view returns (bytes32);
    function getCurrentSubnetRewards(bytes32 subnetId) external view returns (uint256);
    function usersData(address user, bytes32 subnetId)
        external
        view
        returns (uint128 lastDeposit, uint128 unused1, uint256 deposited, uint256 unused2);

    function version() external view returns (uint256);
    function depositToken() external view returns (address);
    function rewardPool() external view returns (address);
    function minimalWithdrawLockPeriod() external view returns (uint256);
    function subnetCreationFeeAmount() external view returns (uint256);
}
