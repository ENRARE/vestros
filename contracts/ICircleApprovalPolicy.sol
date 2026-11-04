// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Onchain, msg.sender-based approvals permanently bound to one vault.
/// No offchain signatures, ERC-1271 validation or arbitrary execution surface.
interface ICircleApprovalPolicy {
    enum ProposalStatus {
        Unknown,
        Pending,
        Approved,
        Executed,
        Expired,
        Invalidated,
        Stale,
        Ineligible
    }

    struct GovernanceProposal {
        uint256 governanceNonce;
        bool pause;
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

    struct SignerSetChange {
        uint256 governanceNonce;
        uint64 signerSetVersion;
        bytes32 previousSignerSetHash;
        bytes32 proposedSignerSetHash;
        uint16 proposedThreshold;
        uint16 approvalCount;
        uint48 executeAfter;
        bool executed;
        bool cancelled;
    }

    event PayoutApproved(bytes32 indexed proposalId, address indexed signer, uint64 signerSetVersion);
    event PayoutProposalInvalidated(bytes32 indexed proposalId, uint256 indexed roundId, uint64 indexed recoveryEpoch);
    event SignerSetProposed(bytes32 indexed changeId, uint64 indexed signerSetVersion, uint48 executeAfter);
    event SignerSetApproved(bytes32 indexed changeId, address indexed signer);
    event SignerSetExecuted(
        bytes32 indexed changeId, bytes32 previousHash, bytes32 nextHash, uint16 threshold, uint64 version
    );
    event GovernanceProposalProposed(
        bytes32 indexed proposalId,
        bool indexed pause,
        uint256 indexed governanceNonce,
        uint48 expiresAt,
        uint64 signerSetVersion,
        uint64 recoveryEpoch
    );
    event GovernanceProposalApproved(bytes32 indexed proposalId, address indexed signer, uint64 signerSetVersion);
    event GovernanceProposalExecuted(bytes32 indexed proposalId, bool indexed pause, uint64 signerSetVersion);
    event GovernanceProposalInvalidated(bytes32 indexed proposalId, uint64 indexed recoveryEpoch);

    function circleVault() external view returns (address);
    function SIGNER_SET_CHANGE_DELAY() external view returns (uint48);
    function signerSetVersion() external view returns (uint64);
    function signerSetHash() external view returns (bytes32);
    function threshold() external view returns (uint16);
    function signerCount() external view returns (uint16);
    function isSigner(address account) external view returns (bool);
    function approvalCount(bytes32 proposalId) external view returns (uint16);
    /// @dev Must recheck version, expiry, recovery and execution state. A cached
    /// count at or above threshold is not sufficient authorization.
    function isPayoutApproved(bytes32 proposalId) external view returns (bool);
    function approvePayout(bytes32 proposalId) external;
    function invalidateProposal(bytes32 proposalId) external;
    function proposeSignerSet(address[] calldata newSigners, uint16 newThreshold) external returns (bytes32 changeId);
    function approveSignerSet(bytes32 changeId) external;
    function executeSignerSet(bytes32 changeId) external;
    function signerSetChange(bytes32 changeId) external view returns (SignerSetChange memory);
    function proposePause(bool pause_) external returns (bytes32 proposalId);
    function approvePause(bytes32 proposalId) external;
    function executePause(bytes32 proposalId) external;
    function invalidatePauseProposal(bytes32 proposalId) external;
    function pauseApprovalCount(bytes32 proposalId) external view returns (uint16);
    function isPauseApproved(bytes32 proposalId) external view returns (bool);
    function pauseProposal(bytes32 proposalId) external view returns (GovernanceProposal memory);
    function pauseProposalStatus(bytes32 proposalId) external view returns (ProposalStatus);
    function payoutProposalStatus(bytes32 proposalId) external view returns (ProposalStatus);
}
