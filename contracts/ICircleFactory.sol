// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICircleVault} from "./ICircleVault.sol";

/// @notice Permissionless circle registry without owner or withdrawal powers.
/// @dev Shared config lives in ICircleVault to avoid importing an implementation
/// into its own interface. This retains the specified ABI tuple encoding.
interface ICircleFactory {
    event CircleCreated(uint256 indexed circleId, address indexed creator, address indexed circle);

    function usdc() external view returns (address);
    function MAX_MEMBERS() external view returns (uint256);
    function MAX_SIGNERS() external view returns (uint256);
    function MAX_ROUNDS() external view returns (uint256);
    function MAX_CIRCLE_DURATION() external view returns (uint48);
    function MAX_PROPOSAL_LIFETIME() external view returns (uint48);
    function circleOf(address creator, uint256 nonce) external view returns (address);
    function circleCount() external view returns (uint256);
    function circleAt(uint256 index) external view returns (address);
    function isCircle(address circle) external view returns (bool);
    /// @dev Must require config.creator == msg.sender, canonical Arc USDC,
    /// bounded unique members/signers, majority threshold and safe deadlines.
    function createCircle(ICircleVault.CircleConfig calldata config) external returns (address circle);
}
