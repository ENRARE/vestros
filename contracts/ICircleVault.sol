// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Phase-1 custody boundary. Financial terms are immutable after
/// activation; the creator has no discretionary transfer or recovery power.
interface ICircleVault {
    enum CircleStatus {
        Draft,
        Active,
        Paused,
        Completed,
        Cancelled,
        Terminated
    }
    enum SettlementMode {
        Automatic,
        Protected
    }
    enum RoundStatus {
        Pending,
        Open,
        Paid,
        Recovery,
        Terminated
    }

    struct CircleConfig {
        address creator;
        address[] members;
        address[] signers;
        uint16 threshold;
        SettlementMode settlementMode;
        uint128 contributionAmount;
        uint48[] roundContributionDeadlines;
        uint48[] roundPayoutDeadlines;
        uint32 roundCount;
        address[] roundRecipients;
        uint128[] roundPayouts;
        uint48 proposalLifetime;
        bytes32 termsHash;
    }

    struct Round {
        uint128 requiredFunding;
        uint128 contributed;
        uint128 payout;
        address recipient;
        uint48 contributionDeadline;
        uint48 payoutDeadline;
        RoundStatus status;
        uint128 refunded;
        bool paid;
    }

    /// @dev Proposal identity commits to chain, vault, policy, circle, round,
    /// recipient, amount, nonce, expiry, terms hash and signer-set version.
    /// Nonces never repeat, including after expiry, invalidation or recovery.
    struct PayoutProposal {
        uint256 proposalNonce;
        uint256 roundId;
        address recipient;
        uint128 amount;
        uint48 expiresAt;
        uint48 createdAt;
        bool executed;
        bool cancelled;
        bytes32 termsHash;
        uint64 signerSetVersion;
        bytes32 signerSetHash;
        uint16 threshold;
        uint64 recoveryEpoch;
    }

    event TermsAccepted(address indexed member, bytes32 indexed termsHash);
    event MemberInvited(address indexed member);
    event MetadataHashUpdated(bytes32 indexed previousHash, bytes32 indexed newHash);
    event CircleActivated(uint256 indexed circleId, bytes32 indexed termsHash);
    event ContributionReceived(uint256 indexed roundId, address indexed member, uint128 amount);
    event PayoutProposed(
        bytes32 indexed proposalId, uint256 indexed roundId, address indexed recipient, uint128 amount
    );
    event PayoutExecuted(
        bytes32 indexed proposalId, uint256 indexed roundId, address indexed recipient, uint128 amount
    );
    event PayoutExpired(bytes32 indexed proposalId);
    event CircleCancelled(bytes32 indexed reasonHash);
    event RoundRecoveryEligible(
        uint256 indexed roundId, uint48 eligibleAt, uint128 roundEscrowed, uint128 requiredFunding, bool fullyFunded
    );
    event RoundRecoveryActivated(
        uint256 indexed roundId, uint64 indexed recoveryEpoch, uint128 roundEscrowed, uint128 refundableAmount
    );
    event PayoutProposalInvalidated(bytes32 indexed proposalId, uint256 indexed roundId, uint64 indexed recoveryEpoch);
    event ContributionRefunded(
        uint256 indexed roundId,
        address indexed member,
        uint128 amount,
        uint128 remainingRoundEscrowed,
        uint256 totalRefunded
    );
    event RoundTerminated(uint256 indexed roundId, uint128 remainingEscrowed, uint64 recoveryEpoch);
    event CircleTerminated(uint256 indexed circleId, uint256 indexed roundId, uint64 indexed recoveryEpoch);

    function usdc() external view returns (address);
    function factory() external view returns (address);
    function creator() external view returns (address);
    function policy() external view returns (address);
    function circleId() external view returns (uint256);
    function status() external view returns (CircleStatus);
    function termsHash() external view returns (bytes32);
    function proposalLifetime() external view returns (uint48);
    function isMember(address member) external view returns (bool);
    function hasAcceptedTerms(address member) external view returns (bool);
    function inviteMember(address member) external;
    function setMetadataHash(bytes32 metadataHash) external;
    function acceptTerms(bytes32 termsHash_) external;
    function activate() external;
    function contribute(uint256 roundId, uint128 amount) external;
    function proposePayout(uint256 roundId) external returns (bytes32 proposalId);
    function executeAutomaticPayout(uint256 roundId) external;
    function executePayout(bytes32 proposalId) external;
    function expireProposal(bytes32 proposalId) external;

    /// @notice Fixed at 72 hours. It cannot be configured by the creator.
    function RECOVERY_GRACE_PERIOD() external view returns (uint48);
    function recoveryEpoch() external view returns (uint64);
    /// @notice Current sequential round, used to enforce the recovery boundary
    /// before policy governance can change its signer set.
    function currentRoundId() external view returns (uint256);
    /// @notice Permissionless and terminal, even while paused. Underfunded:
    /// timestamp > contributionDeadline. Fully funded unpaid:
    /// timestamp > payoutDeadline + 72 hours. At equality payout wins.
    /// Activation transfers no tokens and changes no accounting counters.
    function activateRoundRecovery(uint256 roundId) external;
    /// @notice Creator-only Draft cancellation, with zero liabilities.
    function cancelCircle(bytes32 reasonHash) external;
    /// @notice Only the caller's unrefunded contribution to a recovered round.
    /// Remains available indefinitely, including when paused. Paid rounds
    /// cannot refund. Transfer failure must roll back all accounting.
    function refundContribution(uint256 roundId) external;
    function pause() external;
    function unpause() external;

    /// @dev Conservation: deposited == escrowed + paid + refunded.
    /// Solvency: token balance >= escrowed. Donations are not deposits.
    function totalDeposited() external view returns (uint256);
    function totalEscrowed() external view returns (uint256);
    function totalPaid() external view returns (uint256);
    function totalRefunded() external view returns (uint256);
    function nextProposalNonce() external view returns (uint256);
    function contributedByMember(uint256 roundId, address member) external view returns (uint128);
    function refundedByMember(uint256 roundId, address member) external view returns (uint128);
    function roundEscrowed(uint256 roundId) external view returns (uint128);
    function round(uint256 roundId) external view returns (Round memory);
    function proposal(bytes32 proposalId) external view returns (PayoutProposal memory);
}
