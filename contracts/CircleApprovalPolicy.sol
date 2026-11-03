// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICircleApprovalPolicy} from "./ICircleApprovalPolicy.sol";
import {ICircleVault} from "./ICircleVault.sol";

/// @notice Onchain approval policy with no custody or arbitrary execution authority.
/// @dev The vault constructs this policy and remains the final payout/recovery boundary.
contract CircleApprovalPolicy is ICircleApprovalPolicy {
    error InvalidVault();
    error InvalidSignerSet();
    error UnauthorizedSigner();
    error InvalidProposal();
    error DuplicateApproval();
    error ProposalStillLive();
    error AlreadyInvalidated();
    error InvalidGovernanceChange();
    error GovernanceUnavailable();
    error InsufficientApprovals();
    error GovernanceDelayPending();

    uint16 public constant MAX_SIGNERS = 16;
    uint48 public constant override SIGNER_SET_CHANGE_DELAY = 24 hours;
    bytes32 public constant PAYOUT_PROPOSAL_TYPEHASH = keccak256(
        "PayoutProposal(uint256 chainId,address circleVault,address policy,uint256 circleId,uint256 roundId,address recipient,uint128 amount,uint256 proposalNonce,uint48 expiresAt,bytes32 termsHash,uint64 signerSetVersion)"
    );
    bytes32 public constant PAUSE_GOVERNANCE_TYPEHASH = keccak256(
        "PauseGovernanceProposal(uint256 chainId,address circleVault,address policy,uint256 circleId,bool pause,uint256 proposalNonce,uint64 signerSetVersion,uint64 recoveryEpoch,bytes32 termsHash,uint48 expiresAt)"
    );

    address public immutable override circleVault;
    /// @notice Opt-in creator veto: quorum also requires the creator's approval.
    bool public immutable creatorIncluded;
    uint64 public override signerSetVersion = 1;
    bytes32 public override signerSetHash;
    uint16 public override threshold;
    uint16 public override signerCount;
    mapping(address => bool) public override isSigner;
    address[] private _signers;
    mapping(bytes32 => uint16) private _approvalCounts;
    mapping(bytes32 => mapping(address => bool)) private _approved;
    mapping(bytes32 => bool) private _invalidated;

    struct GovernanceContext {
        address[] signers;
        uint256 chainId;
        bytes32 termsHash;
        uint64 recoveryEpoch;
    }

    uint256 private _nextGovernanceNonce;
    mapping(bytes32 => SignerSetChange) private _signerSetChanges;
    mapping(bytes32 => GovernanceContext) private _governanceContexts;
    mapping(bytes32 => mapping(address => bool)) private _governanceApproved;
    uint256 private _nextPauseNonce;
    mapping(bytes32 => GovernanceProposal) private _pauseProposals;
    mapping(bytes32 => mapping(address => bool)) private _pauseApproved;
    mapping(bytes32 => bool) private _pauseInvalidated;
    bytes32 public constant SIGNER_SET_CHANGE_TYPEHASH = keccak256(
        "SignerSetChange(uint256 chainId,address circleVault,address policy,uint256 circleId,uint256 governanceNonce,uint64 signerSetVersion,bytes32 previousSignerSetHash,bytes32 proposedSignerSetHash,bytes32 termsHash,uint64 recoveryEpoch,uint48 executeAfter)"
    );

    constructor(address circleVault_, address[] memory signers_, uint16 threshold_, bool creatorIncluded_) {
        if (circleVault_ == address(0)) revert InvalidVault();
        _validateSignerSet(signers_, threshold_);
        circleVault = circleVault_;
        creatorIncluded = creatorIncluded_;
        _installSignerSet(signers_, threshold_);
    }

    function approvalCount(bytes32 proposalId) external view override returns (uint16) {
        return _approvalCounts[proposalId];
    }

    function approvePayout(bytes32 proposalId) external override {
        if (!isSigner[msg.sender]) revert UnauthorizedSigner();
        ICircleVault vault = ICircleVault(circleVault);
        ICircleVault.PayoutProposal memory p = vault.proposal(proposalId);
        if (!_isLive(vault, proposalId, p)) revert InvalidProposal();
        if (_approved[proposalId][msg.sender]) revert DuplicateApproval();
        _approved[proposalId][msg.sender] = true;
        ++_approvalCounts[proposalId];
        emit PayoutApproved(proposalId, msg.sender, signerSetVersion);
    }

    function isPayoutApproved(bytes32 proposalId) external view override returns (bool) {
        return _payoutStatus(proposalId) == ProposalStatus.Approved;
    }

    function payoutProposalStatus(bytes32 proposalId) external view override returns (ProposalStatus) {
        return _payoutStatus(proposalId);
    }

    function proposePause(bool pause_) external override returns (bytes32 proposalId) {
        if (!isSigner[msg.sender]) revert UnauthorizedSigner();
        ICircleVault vault = _pauseGovernanceVault();
        ICircleVault.CircleStatus state = vault.status();
        if (
            (pause_ && state != ICircleVault.CircleStatus.Active)
                || (!pause_ && state != ICircleVault.CircleStatus.Paused)
        ) revert InvalidGovernanceChange();

        uint256 expiry = block.timestamp + vault.proposalLifetime();
        if (expiry > type(uint48).max) revert InvalidGovernanceChange();
        uint48 expiresAt = uint48(expiry);
        uint256 nonce = _nextPauseNonce++;
        uint64 epoch = vault.recoveryEpoch();
        proposalId = keccak256(
            abi.encode(
                PAUSE_GOVERNANCE_TYPEHASH,
                block.chainid,
                circleVault,
                address(this),
                vault.circleId(),
                pause_,
                nonce,
                signerSetVersion,
                epoch,
                vault.termsHash(),
                expiresAt
            )
        );
        _pauseProposals[proposalId] = GovernanceProposal({
            governanceNonce: nonce,
            pause: pause_,
            expiresAt: expiresAt,
            createdAt: uint48(block.timestamp),
            executed: false,
            cancelled: false,
            termsHash: vault.termsHash(),
            signerSetVersion: signerSetVersion,
            signerSetHash: signerSetHash,
            threshold: threshold,
            recoveryEpoch: epoch
        });
        emit GovernanceProposalProposed(proposalId, pause_, nonce, expiresAt, signerSetVersion, epoch);
    }

    function approvePause(bytes32 proposalId) external override {
        if (!isSigner[msg.sender]) revert UnauthorizedSigner();
        _currentPauseProposal(proposalId);
        if (_pauseApproved[proposalId][msg.sender]) revert DuplicateApproval();
        _pauseApproved[proposalId][msg.sender] = true;
        emit GovernanceProposalApproved(proposalId, msg.sender, signerSetVersion);
    }

    function isPauseApproved(bytes32 proposalId) external view override returns (bool) {
        return _pauseApprovedFor(proposalId);
    }

    function pauseApprovalCount(bytes32 proposalId) external view override returns (uint16) {
        return _pauseApprovalCount(proposalId);
    }

    function executePause(bytes32 proposalId) external override {
        ICircleVault vault = _currentPauseProposal(proposalId);
        GovernanceProposal storage proposal_ = _pauseProposals[proposalId];
        if (!_pauseApprovedFor(proposalId)) revert InsufficientApprovals();
        proposal_.executed = true;
        if (proposal_.pause) vault.pause();
        else vault.unpause();
        emit GovernanceProposalExecuted(proposalId, proposal_.pause, signerSetVersion);
    }

    function invalidatePauseProposal(bytes32 proposalId) external override {
        if (_pauseInvalidated[proposalId]) revert AlreadyInvalidated();
        GovernanceProposal memory proposal_ = _pauseProposals[proposalId];
        if (proposal_.createdAt == 0 || proposal_.executed) revert InvalidGovernanceChange();
        ICircleVault vault = ICircleVault(circleVault);
        bool desiredStateMissing = proposal_.pause
            ? vault.status() != ICircleVault.CircleStatus.Active
            : vault.status() != ICircleVault.CircleStatus.Paused;
        bool stale = proposal_.cancelled || block.timestamp > proposal_.expiresAt
            || !_currentGovernanceSnapshot(proposal_) || proposal_.recoveryEpoch != vault.recoveryEpoch()
            || proposal_.termsHash != vault.termsHash() || desiredStateMissing
            || vault.status() == ICircleVault.CircleStatus.Terminated
            || vault.status() == ICircleVault.CircleStatus.Cancelled
            || vault.status() == ICircleVault.CircleStatus.Completed;
        if (!stale) revert ProposalStillLive();
        _pauseInvalidated[proposalId] = true;
        emit GovernanceProposalInvalidated(proposalId, vault.recoveryEpoch());
    }

    function pauseProposal(bytes32 proposalId) external view override returns (GovernanceProposal memory) {
        return _pauseProposals[proposalId];
    }

    function pauseProposalStatus(bytes32 proposalId) external view override returns (ProposalStatus) {
        GovernanceProposal memory proposal_ = _pauseProposals[proposalId];
        if (proposal_.createdAt == 0) return ProposalStatus.Unknown;
        if (proposal_.executed) return ProposalStatus.Executed;
        if (proposal_.cancelled || _pauseInvalidated[proposalId]) return ProposalStatus.Invalidated;
        ICircleVault vault = ICircleVault(circleVault);
        if (
            !_knownPause(vault, proposalId, proposal_) || !_currentGovernanceSnapshot(proposal_)
                || proposal_.recoveryEpoch != vault.recoveryEpoch() || proposal_.termsHash != vault.termsHash()
        ) {
            return ProposalStatus.Stale;
        }
        if (block.timestamp > proposal_.expiresAt) return ProposalStatus.Expired;
        bool desiredStateMissing = proposal_.pause
            ? vault.status() != ICircleVault.CircleStatus.Active
            : vault.status() != ICircleVault.CircleStatus.Paused;
        if (desiredStateMissing) return ProposalStatus.Stale;
        return _pauseApprovedFor(proposalId) ? ProposalStatus.Approved : ProposalStatus.Pending;
    }

    function invalidateProposal(bytes32 proposalId) external override {
        if (_invalidated[proposalId]) revert AlreadyInvalidated();
        ICircleVault vault = ICircleVault(circleVault);
        ICircleVault.PayoutProposal memory p = vault.proposal(proposalId);
        if (!_known(vault, proposalId, p) || p.executed) revert InvalidProposal();
        ICircleVault.Round memory r = vault.round(p.roundId);
        ICircleVault.CircleStatus state = vault.status();
        bool stale = p.cancelled || block.timestamp > p.expiresAt || !_currentSnapshot(p)
            || p.recoveryEpoch != vault.recoveryEpoch() || p.termsHash != vault.termsHash()
            || state == ICircleVault.CircleStatus.Terminated || state == ICircleVault.CircleStatus.Cancelled
            || state == ICircleVault.CircleStatus.Completed || r.status == ICircleVault.RoundStatus.Recovery
            || r.status == ICircleVault.RoundStatus.Terminated || block.timestamp > uint256(r.payoutDeadline) + 72 hours;
        if (!stale) revert ProposalStillLive();
        _invalidated[proposalId] = true;
        emit PayoutProposalInvalidated(proposalId, p.roundId, vault.recoveryEpoch());
    }

    function _known(ICircleVault vault, bytes32 proposalId, ICircleVault.PayoutProposal memory p)
        private
        view
        returns (bool)
    {
        if (
            p.recipient == address(0) || p.amount == 0 || p.expiresAt == 0 || p.createdAt > block.timestamp
                || p.expiresAt < p.createdAt || vault.policy() != address(this)
        ) return false;
        return proposalId
            == keccak256(
            abi.encode(
            PAYOUT_PROPOSAL_TYPEHASH,
            block.chainid,
            circleVault,
            address(this),
            vault.circleId(),
            p.roundId,
            p.recipient,
            p.amount,
            p.proposalNonce,
            p.expiresAt,
            p.termsHash,
            p.signerSetVersion
        )
        );
    }

    function _currentSnapshot(ICircleVault.PayoutProposal memory p) private view returns (bool) {
        return p.signerSetVersion == signerSetVersion && p.signerSetHash == signerSetHash && p.threshold == threshold;
    }

    function _isLive(ICircleVault vault, bytes32 proposalId, ICircleVault.PayoutProposal memory p)
        private
        view
        returns (bool)
    {
        if (
            !_known(vault, proposalId, p) || _invalidated[proposalId] || !_currentSnapshot(p) || p.executed
                || p.cancelled || block.timestamp > p.expiresAt || p.termsHash != vault.termsHash()
                || p.recoveryEpoch != vault.recoveryEpoch() || vault.status() != ICircleVault.CircleStatus.Active
                || (creatorIncluded && !isSigner[vault.creator()])
        ) return false;
        ICircleVault.Round memory r = vault.round(p.roundId);
        return r.status == ICircleVault.RoundStatus.Open && !r.paid && r.recipient == p.recipient
            && r.payout == p.amount && r.requiredFunding == p.amount && r.contributed == r.requiredFunding
            && block.timestamp <= uint256(r.payoutDeadline) + 72 hours;
    }

    function _payoutStatus(bytes32 proposalId) private view returns (ProposalStatus) {
        ICircleVault vault = ICircleVault(circleVault);
        ICircleVault.PayoutProposal memory p = vault.proposal(proposalId);
        if (p.createdAt == 0 || !_known(vault, proposalId, p)) return ProposalStatus.Unknown;
        if (p.executed) return ProposalStatus.Executed;
        if (p.cancelled || _invalidated[proposalId]) return ProposalStatus.Invalidated;
        if (!_currentSnapshot(p) || p.recoveryEpoch != vault.recoveryEpoch() || p.termsHash != vault.termsHash()) {
            return ProposalStatus.Stale;
        }
        if (block.timestamp > p.expiresAt) return ProposalStatus.Expired;
        if (vault.status() != ICircleVault.CircleStatus.Active) return ProposalStatus.Ineligible;
        if (creatorIncluded && !isSigner[vault.creator()]) return ProposalStatus.Stale;
        ICircleVault.Round memory r = vault.round(p.roundId);
        if (
            r.status != ICircleVault.RoundStatus.Open || r.paid || r.recipient != p.recipient || r.payout != p.amount
                || r.requiredFunding != p.amount || r.contributed != r.requiredFunding
                || block.timestamp > uint256(r.payoutDeadline) + 72 hours
        ) return ProposalStatus.Ineligible;
        return _approvalCounts[proposalId] >= threshold && (!creatorIncluded || _approved[proposalId][vault.creator()])
            ? ProposalStatus.Approved
            : ProposalStatus.Pending;
    }

    function _pauseGovernanceVault() private view returns (ICircleVault vault) {
        vault = ICircleVault(circleVault);
        ICircleVault.CircleStatus state = vault.status();
        if (
            vault.policy() != address(this)
                || (state != ICircleVault.CircleStatus.Active && state != ICircleVault.CircleStatus.Paused)
        ) revert GovernanceUnavailable();
    }

    function _currentPauseProposal(bytes32 proposalId) private view returns (ICircleVault vault) {
        GovernanceProposal memory proposal_ = _pauseProposals[proposalId];
        vault = _pauseGovernanceVault();
        if (
            !_knownPause(vault, proposalId, proposal_) || _pauseInvalidated[proposalId] || proposal_.executed
                || proposal_.cancelled || !_currentGovernanceSnapshot(proposal_)
                || proposal_.recoveryEpoch != vault.recoveryEpoch() || proposal_.termsHash != vault.termsHash()
                || block.timestamp > proposal_.expiresAt
        ) revert InvalidGovernanceChange();
        bool desiredStateMissing = proposal_.pause
            ? vault.status() != ICircleVault.CircleStatus.Active
            : vault.status() != ICircleVault.CircleStatus.Paused;
        if (desiredStateMissing) revert InvalidGovernanceChange();
    }

    function _pauseApprovedFor(bytes32 proposalId) private view returns (bool) {
        GovernanceProposal memory proposal_ = _pauseProposals[proposalId];
        ICircleVault vault = ICircleVault(circleVault);
        if (
            !_knownPause(vault, proposalId, proposal_) || _pauseInvalidated[proposalId] || proposal_.executed
                || proposal_.cancelled || !_currentGovernanceSnapshot(proposal_)
                || proposal_.recoveryEpoch != vault.recoveryEpoch() || proposal_.termsHash != vault.termsHash()
                || block.timestamp > proposal_.expiresAt
        ) return false;
        bool desiredStateMissing = proposal_.pause
            ? vault.status() != ICircleVault.CircleStatus.Active
            : vault.status() != ICircleVault.CircleStatus.Paused;
        return !desiredStateMissing && _pauseApprovalCount(proposalId) >= threshold
            && (!creatorIncluded || _pauseApproved[proposalId][vault.creator()]);
    }

    function _pauseApprovalCount(bytes32 proposalId) private view returns (uint16 count) {
        // Approval counts are tracked by signer address; this bounded scan is
        // limited by MAX_SIGNERS and is used only for the governance view.
        for (uint256 i; i < _signers.length; ++i) {
            if (_pauseApproved[proposalId][_signers[i]]) ++count;
        }
    }

    function _knownPause(ICircleVault vault, bytes32 proposalId, GovernanceProposal memory proposal_)
        private
        view
        returns (bool)
    {
        if (
            proposal_.createdAt == 0 || proposal_.expiresAt == 0 || proposal_.createdAt > block.timestamp
                || proposal_.expiresAt < proposal_.createdAt || vault.policy() != address(this)
        ) return false;
        return proposalId
            == keccak256(
            abi.encode(
            PAUSE_GOVERNANCE_TYPEHASH,
            block.chainid,
            circleVault,
            address(this),
            vault.circleId(),
            proposal_.pause,
            proposal_.governanceNonce,
            proposal_.signerSetVersion,
            proposal_.recoveryEpoch,
            proposal_.termsHash,
            proposal_.expiresAt
        )
        );
    }

    function _currentGovernanceSnapshot(GovernanceProposal memory proposal_) private view returns (bool) {
        return proposal_.signerSetVersion == signerSetVersion && proposal_.signerSetHash == signerSetHash
            && proposal_.threshold == threshold;
    }

    function _validateSignerSet(address[] memory signers_, uint16 threshold_) private pure {
        uint256 count = signers_.length;
        if (count == 0 || count > MAX_SIGNERS || threshold_ <= count / 2 || threshold_ > count) {
            revert InvalidSignerSet();
        }
        for (uint256 i; i < count; ++i) {
            if (signers_[i] == address(0)) revert InvalidSignerSet();
            for (uint256 j; j < i; ++j) {
                if (signers_[i] == signers_[j]) revert InvalidSignerSet();
            }
        }
    }

    function _installSignerSet(address[] memory signers_, uint16 threshold_) private {
        for (uint256 i; i < _signers.length; ++i) {
            isSigner[_signers[i]] = false;
        }
        delete _signers;
        for (uint256 i; i < signers_.length; ++i) {
            _signers.push(signers_[i]);
            isSigner[signers_[i]] = true;
        }
        threshold = threshold_;
        signerCount = uint16(signers_.length);
        signerSetHash = keccak256(abi.encode(signers_, threshold_));
    }

    function proposeSignerSet(address[] calldata newSigners, uint16 newThreshold)
        external
        override
        returns (bytes32 changeId)
    {
        if (!isSigner[msg.sender]) revert UnauthorizedSigner();
        ICircleVault vault = _governanceVault();
        _validateSignerSet(newSigners, newThreshold);
        if (creatorIncluded) {
            address admin = vault.creator();
            bool includesCreator;
            for (uint256 i; i < newSigners.length; ++i) {
                if (newSigners[i] == admin) includesCreator = true;
            }
            if (!includesCreator) revert InvalidSignerSet();
        }

        uint256 readyAt = block.timestamp + SIGNER_SET_CHANGE_DELAY;
        if (readyAt > type(uint48).max) revert InvalidGovernanceChange();
        uint48 executeAfter = uint48(readyAt);
        uint256 nonce = _nextGovernanceNonce++;
        bytes32 nextHash = keccak256(abi.encode(newSigners, newThreshold));
        bytes32 acceptedTerms = vault.termsHash();
        uint64 epoch = vault.recoveryEpoch();
        changeId = keccak256(
            abi.encode(
                SIGNER_SET_CHANGE_TYPEHASH,
                block.chainid,
                circleVault,
                address(this),
                vault.circleId(),
                nonce,
                signerSetVersion,
                signerSetHash,
                nextHash,
                acceptedTerms,
                epoch,
                executeAfter
            )
        );
        _signerSetChanges[changeId] = SignerSetChange({
            governanceNonce: nonce,
            signerSetVersion: signerSetVersion,
            previousSignerSetHash: signerSetHash,
            proposedSignerSetHash: nextHash,
            proposedThreshold: newThreshold,
            approvalCount: 0,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false
        });
        _governanceContexts[changeId] = GovernanceContext(newSigners, block.chainid, acceptedTerms, epoch);
        emit SignerSetProposed(changeId, signerSetVersion, executeAfter);
    }

    function approveSignerSet(bytes32 changeId) external override {
        if (!isSigner[msg.sender]) revert UnauthorizedSigner();
        _currentChange(changeId);
        if (_governanceApproved[changeId][msg.sender]) revert DuplicateApproval();
        _governanceApproved[changeId][msg.sender] = true;
        ++_signerSetChanges[changeId].approvalCount;
        emit SignerSetApproved(changeId, msg.sender);
    }

    /// @notice Anyone may execute; authority comes exclusively from the old
    /// signer quorum and (if enabled) creator approval, after the timelock.
    function executeSignerSet(bytes32 changeId) external override {
        ICircleVault vault = _currentChange(changeId);
        SignerSetChange storage change = _signerSetChanges[changeId];
        if (change.approvalCount < threshold || (creatorIncluded && !_governanceApproved[changeId][vault.creator()])) {
            revert InsufficientApprovals();
        }
        if (block.timestamp < change.executeAfter) revert GovernanceDelayPending();
        change.executed = true;
        ++signerSetVersion;
        _installSignerSet(_governanceContexts[changeId].signers, change.proposedThreshold);
        emit SignerSetExecuted(changeId, change.previousSignerSetHash, signerSetHash, threshold, signerSetVersion);
    }

    /// @dev Historical records retain their approval counts. Execution always
    /// rechecks the current version; a recorded quorum is not live authority.
    function signerSetChange(bytes32 changeId) external view override returns (SignerSetChange memory) {
        return _signerSetChanges[changeId];
    }

    function _currentChange(bytes32 changeId) private view returns (ICircleVault vault) {
        SignerSetChange storage change = _signerSetChanges[changeId];
        if (
            change.executeAfter == 0 || change.executed || change.cancelled
                || change.signerSetVersion != signerSetVersion || change.previousSignerSetHash != signerSetHash
        ) {
            revert InvalidGovernanceChange();
        }
        vault = _governanceVault();
        GovernanceContext storage context = _governanceContexts[changeId];
        if (
            context.chainId != block.chainid || context.termsHash != vault.termsHash()
                || context.recoveryEpoch != vault.recoveryEpoch()
        ) revert InvalidGovernanceChange();
    }

    function _governanceVault() private view returns (ICircleVault vault) {
        vault = ICircleVault(circleVault);
        ICircleVault.CircleStatus state = vault.status();
        if (
            vault.policy() != address(this)
                || (state != ICircleVault.CircleStatus.Active && state != ICircleVault.CircleStatus.Paused)
                || (creatorIncluded && !isSigner[vault.creator()])
        ) revert GovernanceUnavailable();
        ICircleVault.Round memory r = vault.round(vault.currentRoundId());
        if (
            r.status != ICircleVault.RoundStatus.Open || r.paid || r.requiredFunding == 0
                || r.contributed > r.requiredFunding
                || (r.contributed < r.requiredFunding && block.timestamp > r.contributionDeadline)
                || block.timestamp > uint256(r.payoutDeadline) + 72 hours
        ) revert GovernanceUnavailable();
    }
}
