// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICircleFactory} from "./ICircleFactory.sol";
import {ICircleVault} from "./ICircleVault.sol";
import {CircleVault} from "./CircleVault.sol";

/// @notice Permissionless registry for independently governed circle vaults.
/// @dev The factory has no owner and no authority over deployed circles.
contract CircleFactory is ICircleFactory {
    error InvalidUsdc();
    error CreatorMismatch();
    error InvalidConfiguration();

    address public constant CANONICAL_ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 public constant override MAX_MEMBERS = 32;
    uint256 public constant override MAX_SIGNERS = 16;
    uint256 public constant override MAX_ROUNDS = 32;
    uint48 public constant override MAX_CIRCLE_DURATION = 365 days;
    uint48 public constant override MAX_PROPOSAL_LIFETIME = 7 days;

    address public immutable override usdc;
    uint256 public override circleCount;
    mapping(uint256 => address) public override circleAt;
    mapping(address => mapping(uint256 => address)) public override circleOf;
    mapping(address => bool) public override isCircle;
    mapping(address => uint256) private _creatorNonce;

    constructor(address usdc_) {
        if (usdc_ != CANONICAL_ARC_USDC) revert InvalidUsdc();
        usdc = usdc_;
    }

    function createCircle(ICircleVault.CircleConfig calldata config) external override returns (address circle) {
        if (config.creator != msg.sender) revert CreatorMismatch();
        _validateFactoryBounds(config);
        uint256 nonce = _creatorNonce[msg.sender]++;
        circle = address(new CircleVault(usdc, circleCount, config));
        circleAt[circleCount] = circle;
        circleOf[msg.sender][nonce] = circle;
        isCircle[circle] = true;
        ++circleCount;
        emit CircleCreated(ICircleVault(circle).circleId(), msg.sender, circle);
    }

    function _validateFactoryBounds(ICircleVault.CircleConfig calldata config) private view {
        if (config.members.length == 0 || config.members.length > MAX_MEMBERS) revert InvalidConfiguration();
        if (config.signers.length == 0 || config.signers.length > MAX_SIGNERS) revert InvalidConfiguration();
        if (config.threshold <= config.signers.length / 2 || config.threshold > config.signers.length) {
            revert InvalidConfiguration();
        }
        if (config.roundCount == 0 || config.roundCount > MAX_ROUNDS) revert InvalidConfiguration();
        if (config.proposalLifetime == 0 || config.proposalLifetime > MAX_PROPOSAL_LIFETIME) {
            revert InvalidConfiguration();
        }
        if (
            config.roundContributionDeadlines.length != config.roundCount
                || config.roundPayoutDeadlines.length != config.roundCount
                || config.roundRecipients.length != config.roundCount || config.roundPayouts.length != config.roundCount
        ) revert InvalidConfiguration();
        for (uint256 i; i < config.members.length; ++i) {
            if (config.members[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (config.members[i] == config.members[j]) revert InvalidConfiguration();
            }
        }
        for (uint256 i; i < config.signers.length; ++i) {
            if (config.signers[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (config.signers[i] == config.signers[j]) revert InvalidConfiguration();
            }
        }
        uint256 maxDeadline = block.timestamp + MAX_CIRCLE_DURATION;
        for (uint256 i; i < config.roundCount; ++i) {
            if (config.roundRecipients[i] == address(0) || config.roundPayouts[i] == 0) revert InvalidConfiguration();
            if (config.roundContributionDeadlines[i] >= config.roundPayoutDeadlines[i]) revert InvalidConfiguration();
            if (config.roundPayoutDeadlines[i] > maxDeadline) revert InvalidConfiguration();
            if (uint256(config.roundPayoutDeadlines[i]) + 72 hours > type(uint48).max) revert InvalidConfiguration();
            if (uint256(config.roundPayouts[i]) != uint256(config.contributionAmount) * config.members.length) {
                revert InvalidConfiguration();
            }
        }
    }
}
