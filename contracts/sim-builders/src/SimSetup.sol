// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IRewardPool} from "./morpheus/interfaces/IRewardPool.sol";
import {IBuildersV4} from "./morpheus/interfaces/builder-protocol/IBuildersV4.sol";
import {RewardPool} from "./morpheus/RewardPool.sol";
import {FeeConfig} from "./morpheus/builder-protocol/FeeConfig.sol";
import {BuildersTreasuryV2} from "./morpheus/builder-protocol/BuildersTreasuryV2.sol";
import {BuildersV4} from "./morpheus/builder-protocol/BuildersV4.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title SimSetup
/// @notice Testnet only. In one transaction: wires Morpheus's Builders contracts with mainnet's settings, funds the
/// treasury and stakes a stand-in for the rest of Morpheus's subnets, so pools earn at about mainnet's rate.
contract SimSetup {
    /// @dev Builders emission on Base mainnet (RewardPool index 3, read 2026-11-02).
    uint128 internal constant PAYOUT_START = 1_707_393_600;
    uint128 internal constant DECREASE_INTERVAL = 1 days;
    uint256 internal constant INITIAL_REWARD = 3_456e18;
    uint256 internal constant REWARD_DECREASE = 592_558_728_240_000_000;

    /// @dev Mainnet's values: 80% of the emission to Base subnets (1e25 = 100%), 7-day minimum withdraw lock.
    uint256 internal constant NETWORK_SHARE = 8e24;
    uint256 internal constant MIN_WITHDRAW_LOCK = 7 days;

    /// @dev About what is staked across all Base subnets on mainnet.
    uint256 public constant SEED_STAKE = 2_925_000e18;
    uint256 public constant TREASURY_FUNDING = 10_000_000e18;

    address public immutable rewardPool;
    address public immutable feeConfig;
    address public immutable treasury;
    address public immutable builders;

    constructor(address owner, address mor, address rewardPoolImpl, address feeConfigImpl, address treasuryImpl, address buildersImpl) {
        IRewardPool.RewardPool[] memory pools = new IRewardPool.RewardPool[](4);
        for (uint256 i; i < pools.length; ++i) {
            pools[i] = IRewardPool.RewardPool(PAYOUT_START, DECREASE_INTERVAL, INITIAL_REWARD, REWARD_DECREASE, false);
        }
        rewardPool = address(new ERC1967Proxy(rewardPoolImpl, abi.encodeCall(RewardPool.RewardPool_init, (pools))));
        feeConfig = address(new ERC1967Proxy(feeConfigImpl, abi.encodeCall(FeeConfig.FeeConfig_init, (owner, 0))));
        treasury = address(new ERC1967Proxy(treasuryImpl, abi.encodeCall(BuildersTreasuryV2.BuildersTreasuryV2_init, (mor))));
        builders = address(
            new ERC1967Proxy(
                buildersImpl,
                abi.encodeCall(BuildersV4.BuildersV4_init, (mor, feeConfig, treasury, rewardPool, address(this), MIN_WITHDRAW_LOCK))
            )
        );

        BuildersV4 b = BuildersV4(builders);
        b.setNetworkShare(NETWORK_SHARE);
        b.setNetworkShareOwner(owner);
        BuildersTreasuryV2(treasury).setBuilders(builders);

        IMintable token = IMintable(mor);
        token.mint(treasury, TREASURY_FUNDING);
        token.mint(address(this), SEED_STAKE);
        token.approve(builders, SEED_STAKE);
        string memory name = "Simulated rest of Morpheus Builders";
        b.createSubnet(
            IBuildersV4.Subnet(name, owner, 0, uint128(MIN_WITHDRAW_LOCK), 0, 0, owner),
            IBuildersV4.SubnetMetadata("simulated", "Testnet stand-in for every other subnet", "", "")
        );
        b.deposit(b.getSubnetId(name), SEED_STAKE);

        RewardPool(rewardPool).transferOwnership(owner);
        FeeConfig(feeConfig).transferOwnership(owner);
        BuildersTreasuryV2(treasury).transferOwnership(owner);
        b.transferOwnership(owner);
    }
}
