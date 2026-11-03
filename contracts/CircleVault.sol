// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICircleVault} from "./ICircleVault.sol";
import {ICircleApprovalPolicy} from "./ICircleApprovalPolicy.sol";
import {CircleApprovalPolicy} from "./CircleApprovalPolicy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Phase-1 circle escrow with immutable financial terms.
/// @dev This contract is the only component allowed to move circle USDC.
///      It deliberately has no arbitrary transfer, delegatecall, or creator
///      withdrawal path.
contract CircleVault is ICircleVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidConfiguration();
    error InvalidTermsHash();
    error InvalidMember();
    error DuplicateMember();
    error DuplicateSigner();
    error InvalidRound();
    error InvalidDeadline();
    error InvalidProposalLifetime();
    error UnauthorizedCreator();
    error UnauthorizedPolicy();
    error InvalidStatus();
    error TermsNotAccepted();
    error AlreadyAccepted();
    error InvalidTerms();
    error NotMember();
    error NotCurrentRound();
    error ContributionWindowClosed();
    error ContributionMismatch();
    error AlreadyContributed();
    error RoundNotFunded();
    error SettlementModeMismatch();
    error InvalidPayoutProposal();
    error ProposalNotExpired();
    error ProposalAlreadySettled();
    error RecoveryNotAvailable();
    error NoRefundAvailable();
    error RoundAlreadyPaid();
    error FutureRoundBlocked();
    error ZeroAddress();
    error ZeroAmount();

    uint48 public constant override RECOVERY_GRACE_PERIOD = 72 hours;
    uint256 public constant MAX_MEMBERS = 32;
    uint256 public constant MAX_SIGNERS = 16;
    uint256 public constant MAX_ROUNDS = 32;
    uint48 public constant MAX_CIRCLE_DURATION = 365 days;
    uint48 public constant MAX_PROPOSAL_LIFETIME = 7 days;

    bytes32 private constant PAYOUT_PROPOSAL_TYPEHASH = keccak256(
        "PayoutProposal(uint256 chainId,address circleVault,address policy,uint256 circleId,uint256 roundId,address recipient,uint128 amount,uint256 proposalNonce,uint48 expiresAt,bytes32 termsHash,uint64 signerSetVersion)"
    );

    address public immutable override usdc;
    IERC20 private immutable _token;
    address public immutable override factory;
    address public immutable override creator;
    uint256 public immutable override circleId;
    address public immutable override policy;

    CircleStatus public override status;
    SettlementMode public immutable settlementMode;
    uint128 public immutable contributionAmount;
    uint48 public immutable proposalLifetime;
    bytes32 public override termsHash;
    bytes32 public metadataHash;

    uint64 public override recoveryEpoch;
    uint256 public override currentRoundId;
    uint256 public override nextProposalNonce;

    uint256 public override totalDeposited;
    uint256 public override totalEscrowed;
    uint256 public override totalPaid;
    uint256 public override totalRefunded;

    mapping(address => bool) public override isMember;
    mapping(address => bytes32) private _acceptedTerms;
    mapping(address => uint128) private _memberTotalContributed;

    mapping(uint256 => mapping(address => uint128)) public override contributedByMember;
    mapping(uint256 => mapping(address => uint128)) public override refundedByMember;
    Round[] private _rounds;
    mapping(bytes32 => PayoutProposal) private _proposals;
    mapping(uint256 => bytes32) private _latestProposalByRound;
    CircleConfig private _config;

    constructor(address usdc_, uint256 circleId_, CircleConfig memory config) {
        _validateConfig(usdc_, config);
        usdc = usdc_;
        _token = IERC20(usdc_);
        factory = msg.sender;
        creator = config.creator;
        circleId = circleId_;
        settlementMode = config.settlementMode;
        contributionAmount = config.contributionAmount;
        proposalLifetime = config.proposalLifetime;
        termsHash = config.termsHash;
        status = CircleStatus.Draft;

        _config = config;
        for (uint256 i; i < config.members.length; ++i) {
            isMember[config.members[i]] = true;
        }

        bool creatorIncluded;
        for (uint256 i; i < config.signers.length; ++i) {
            if (config.signers[i] == config.creator) creatorIncluded = true;
        }

        CircleApprovalPolicy createdPolicy =
            new CircleApprovalPolicy(address(this), config.signers, config.threshold, creatorIncluded);
        policy = address(createdPolicy);

        for (uint256 i; i < config.roundCount; ++i) {
            _rounds.push(
                Round({
                    requiredFunding: config.roundPayouts[i],
                    contributed: 0,
                    payout: config.roundPayouts[i],
                    recipient: config.roundRecipients[i],
                    contributionDeadline: config.roundContributionDeadlines[i],
                    payoutDeadline: config.roundPayoutDeadlines[i],
                    status: RoundStatus.Pending,
                    refunded: 0,
                    paid: false
                })
            );
        }
    }

    modifier onlyCreator() {
        if (msg.sender != creator) revert UnauthorizedCreator();
        _;
    }

    modifier onlyPolicy() {
        if (msg.sender != policy) revert UnauthorizedPolicy();
        _;
    }

    modifier activeStatus() {
        if (status != CircleStatus.Active) revert InvalidStatus();
        _;
    }

    function hasAcceptedTerms(address member) external view override returns (bool) {
        return isMember[member] && _acceptedTerms[member] == termsHash;
    }

    function inviteMember(address member) external override onlyCreator {
        if (status != CircleStatus.Draft) revert InvalidStatus();
        if (member == address(0)) revert InvalidMember();
        if (isMember[member]) revert DuplicateMember();
        if (_config.members.length >= MAX_MEMBERS) revert InvalidConfiguration();
        _config.members.push(member);
        isMember[member] = true;
        _config.termsHash = bytes32(0);
        termsHash = keccak256(abi.encode(_config));
        _config.termsHash = termsHash;
    }

    function setMetadataHash(bytes32 metadataHash_) external override onlyCreator {
        if (status == CircleStatus.Cancelled || status == CircleStatus.Terminated) revert InvalidStatus();
        bytes32 previousHash = metadataHash;
        metadataHash = metadataHash_;
        emit MetadataHashUpdated(previousHash, metadataHash_);
    }

    function acceptTerms(bytes32 termsHash_) external override {
        if (status != CircleStatus.Draft) revert InvalidStatus();
        if (!isMember[msg.sender]) revert NotMember();
        if (termsHash_ != termsHash) revert InvalidTerms();
        if (_acceptedTerms[msg.sender] == termsHash) revert AlreadyAccepted();
        _acceptedTerms[msg.sender] = termsHash;
        emit TermsAccepted(msg.sender, termsHash);
    }

    function activate() external override onlyCreator {
        if (status != CircleStatus.Draft) revert InvalidStatus();
        for (uint256 i; i < _config.members.length; ++i) {
            if (_acceptedTerms[_config.members[i]] != termsHash) revert TermsNotAccepted();
        }
        status = CircleStatus.Active;
        _rounds[0].status = RoundStatus.Open;
        emit CircleActivated(circleId, termsHash);
    }

    function contribute(uint256 roundId, uint128 amount) external override nonReentrant activeStatus {
        if (roundId != currentRoundId) revert NotCurrentRound();
        Round storage r = _round(roundId);
        if (r.status != RoundStatus.Open || r.paid) revert InvalidRound();
        if (block.timestamp > r.contributionDeadline) revert ContributionWindowClosed();
        if (!isMember[msg.sender]) revert NotMember();
        if (amount != contributionAmount) revert ContributionMismatch();
        if (contributedByMember[roundId][msg.sender] != 0) revert AlreadyContributed();
        if (uint256(r.contributed) + amount > r.requiredFunding) revert ContributionMismatch();

        contributedByMember[roundId][msg.sender] = amount;
        r.contributed += amount;
        totalDeposited += amount;
        totalEscrowed += amount;
        _token.safeTransferFrom(msg.sender, address(this), amount);
        emit ContributionReceived(roundId, msg.sender, amount);
    }

    function proposePayout(uint256 roundId) external override onlyCreator activeStatus returns (bytes32 proposalId) {
        if (settlementMode != SettlementMode.Protected) revert SettlementModeMismatch();
        if (roundId != currentRoundId) revert NotCurrentRound();
        Round storage r = _round(roundId);
        if (r.status != RoundStatus.Open || r.paid || r.contributed != r.requiredFunding) revert RoundNotFunded();
        if (block.timestamp > uint256(r.payoutDeadline) + RECOVERY_GRACE_PERIOD) revert InvalidPayoutProposal();

        uint256 expiry = block.timestamp + proposalLifetime;
        if (expiry > type(uint48).max) revert InvalidPayoutProposal();
        uint48 expiresAt = uint48(expiry);
        uint64 version = ICircleApprovalPolicy(policy).signerSetVersion();
        bytes32 signerHash = ICircleApprovalPolicy(policy).signerSetHash();
        uint16 signerThreshold = ICircleApprovalPolicy(policy).threshold();
        uint256 nonce = nextProposalNonce++;
        proposalId = keccak256(
            abi.encode(
                PAYOUT_PROPOSAL_TYPEHASH,
                block.chainid,
                address(this),
                policy,
                circleId,
                roundId,
                r.recipient,
                r.payout,
                nonce,
                expiresAt,
                termsHash,
                version
            )
        );
        if (_proposals[proposalId].createdAt != 0) revert InvalidPayoutProposal();
        _proposals[proposalId] = PayoutProposal({
            proposalNonce: nonce,
            roundId: roundId,
            recipient: r.recipient,
            amount: r.payout,
            expiresAt: expiresAt,
            createdAt: uint48(block.timestamp),
            executed: false,
            cancelled: false,
            termsHash: termsHash,
            signerSetVersion: version,
            signerSetHash: signerHash,
            threshold: signerThreshold,
            recoveryEpoch: recoveryEpoch
        });
        _latestProposalByRound[roundId] = proposalId;
        emit PayoutProposed(proposalId, roundId, r.recipient, r.payout);
    }

    function executeAutomaticPayout(uint256 roundId) external override nonReentrant activeStatus {
        if (settlementMode != SettlementMode.Automatic) revert SettlementModeMismatch();
        if (roundId != currentRoundId) revert NotCurrentRound();
        Round storage r = _round(roundId);
        if (r.status != RoundStatus.Open || r.paid || r.contributed != r.requiredFunding) revert RoundNotFunded();
        if (block.timestamp > uint256(r.payoutDeadline) + RECOVERY_GRACE_PERIOD) revert RecoveryNotAvailable();
        _settleRound(r, roundId, r.recipient, r.payout);
    }

    function executePayout(bytes32 proposalId) external override nonReentrant activeStatus {
        if (settlementMode != SettlementMode.Protected) revert SettlementModeMismatch();
        PayoutProposal storage p = _proposals[proposalId];
        if (p.createdAt == 0 || p.executed || p.cancelled) revert InvalidPayoutProposal();
        if (!ICircleApprovalPolicy(policy).isPayoutApproved(proposalId)) revert InvalidPayoutProposal();
        if (p.roundId != currentRoundId) revert InvalidPayoutProposal();
        Round storage r = _round(p.roundId);
        if (r.status != RoundStatus.Open || r.paid || r.recipient != p.recipient || r.payout != p.amount) {
            revert InvalidPayoutProposal();
        }
        _settleRound(r, p.roundId, p.recipient, p.amount);
        p.executed = true;
        emit PayoutExecuted(proposalId, p.roundId, p.recipient, p.amount);
    }

    function expireProposal(bytes32 proposalId) external override {
        PayoutProposal storage p = _proposals[proposalId];
        if (p.createdAt == 0 || p.executed || p.cancelled) revert ProposalAlreadySettled();
        if (block.timestamp <= p.expiresAt) revert ProposalNotExpired();
        p.cancelled = true;
        emit PayoutExpired(proposalId);
    }

    function activateRoundRecovery(uint256 roundId) external override {
        if (status != CircleStatus.Active && status != CircleStatus.Paused) revert RecoveryNotAvailable();
        if (roundId != currentRoundId) revert FutureRoundBlocked();
        Round storage r = _round(roundId);
        if (r.status != RoundStatus.Open || r.paid) revert RecoveryNotAvailable();
        bool fullyFunded = r.contributed == r.requiredFunding;
        bool eligible = fullyFunded
            ? block.timestamp > uint256(r.payoutDeadline) + RECOVERY_GRACE_PERIOD
            : block.timestamp > r.contributionDeadline;
        if (!eligible) revert RecoveryNotAvailable();

        uint128 escrowed = _roundEscrowed(r);
        emit RoundRecoveryEligible(roundId, uint48(block.timestamp), escrowed, r.requiredFunding, fullyFunded);
        bytes32 proposalId = _latestProposalByRound[roundId];
        if (proposalId != bytes32(0)) {
            PayoutProposal storage p = _proposals[proposalId];
            if (!p.executed && !p.cancelled) {
                p.cancelled = true;
                emit PayoutProposalInvalidated(proposalId, roundId, recoveryEpoch + 1);
            }
        }
        ++recoveryEpoch;
        r.status = RoundStatus.Recovery;
        status = CircleStatus.Terminated;
        emit RoundRecoveryActivated(roundId, recoveryEpoch, escrowed, escrowed);
        emit RoundTerminated(roundId, escrowed, recoveryEpoch);
        emit CircleTerminated(circleId, roundId, recoveryEpoch);
    }

    function cancelCircle(bytes32 reasonHash) external override onlyCreator {
        if (status != CircleStatus.Draft) revert InvalidStatus();
        if (totalDeposited != 0) revert InvalidStatus();
        status = CircleStatus.Cancelled;
        emit CircleCancelled(reasonHash);
    }

    function refundContribution(uint256 roundId) external override nonReentrant {
        if (status != CircleStatus.Terminated) revert InvalidStatus();
        Round storage r = _round(roundId);
        if (r.status != RoundStatus.Recovery || r.paid) revert NoRefundAvailable();
        uint128 contributed = contributedByMember[roundId][msg.sender];
        uint128 alreadyRefunded = refundedByMember[roundId][msg.sender];
        if (contributed <= alreadyRefunded) revert NoRefundAvailable();
        uint128 amount = contributed - alreadyRefunded;
        uint128 remaining = _roundEscrowed(r) - amount;
        refundedByMember[roundId][msg.sender] = contributed;
        r.refunded += amount;
        totalRefunded += amount;
        totalEscrowed -= amount;
        _token.safeTransfer(msg.sender, amount);
        emit ContributionRefunded(roundId, msg.sender, amount, remaining, totalRefunded);
    }

    function pause() external override onlyPolicy {
        if (status != CircleStatus.Active) revert InvalidStatus();
        status = CircleStatus.Paused;
    }

    function unpause() external override onlyPolicy {
        if (status != CircleStatus.Paused) revert InvalidStatus();
        status = CircleStatus.Active;
    }

    function round(uint256 roundId) external view override returns (Round memory) {
        return _round(roundId);
    }

    function proposal(bytes32 proposalId) external view override returns (PayoutProposal memory) {
        return _proposals[proposalId];
    }

    function roundEscrowed(uint256 roundId) public view override returns (uint128) {
        return _roundEscrowed(_round(roundId));
    }

    function _settleRound(Round storage r, uint256 roundId, address recipient, uint128 amount) private {
        if (_roundEscrowed(r) != amount) revert InvalidPayoutProposal();
        r.paid = true;
        r.status = RoundStatus.Paid;
        totalEscrowed -= amount;
        totalPaid += amount;
        _token.safeTransfer(recipient, amount);
        if (roundId + 1 < _rounds.length) {
            currentRoundId = roundId + 1;
            _rounds[roundId + 1].status = RoundStatus.Open;
        } else {
            status = CircleStatus.Completed;
        }
    }

    function _roundEscrowed(Round storage r) private view returns (uint128) {
        if (r.paid) return 0;
        return r.contributed - r.refunded;
    }

    function _round(uint256 roundId) private view returns (Round storage r) {
        if (roundId >= _rounds.length) revert InvalidRound();
        return _rounds[roundId];
    }

    function _validateConfig(address usdc_, CircleConfig memory config) private view {
        if (usdc_ == address(0) || config.creator == address(0) || config.contributionAmount == 0) {
            revert InvalidConfiguration();
        }
        if (config.members.length == 0 || config.members.length > MAX_MEMBERS) revert InvalidConfiguration();
        if (config.signers.length == 0 || config.signers.length > MAX_SIGNERS) revert InvalidConfiguration();
        if (config.threshold <= config.signers.length / 2 || config.threshold > config.signers.length) {
            revert InvalidConfiguration();
        }
        if (config.roundCount == 0 || config.roundCount > MAX_ROUNDS) revert InvalidConfiguration();
        if (config.proposalLifetime == 0 || config.proposalLifetime > MAX_PROPOSAL_LIFETIME) {
            revert InvalidProposalLifetime();
        }
        if (
            config.roundContributionDeadlines.length != config.roundCount
                || config.roundPayoutDeadlines.length != config.roundCount
                || config.roundRecipients.length != config.roundCount || config.roundPayouts.length != config.roundCount
        ) revert InvalidConfiguration();
        bytes32 suppliedTermsHash = config.termsHash;
        CircleConfig memory committed = CircleConfig({
            creator: config.creator,
            members: config.members,
            signers: config.signers,
            threshold: config.threshold,
            settlementMode: config.settlementMode,
            contributionAmount: config.contributionAmount,
            roundContributionDeadlines: config.roundContributionDeadlines,
            roundPayoutDeadlines: config.roundPayoutDeadlines,
            roundCount: config.roundCount,
            roundRecipients: config.roundRecipients,
            roundPayouts: config.roundPayouts,
            proposalLifetime: config.proposalLifetime,
            termsHash: bytes32(0)
        });
        bytes32 expectedTermsHash = keccak256(abi.encode(committed));
        if (expectedTermsHash != suppliedTermsHash) revert InvalidTermsHash();
        for (uint256 i; i < config.members.length; ++i) {
            if (config.members[i] == address(0)) revert InvalidMember();
            for (uint256 j; j < i; ++j) {
                if (config.members[i] == config.members[j]) revert DuplicateMember();
            }
        }
        for (uint256 i; i < config.signers.length; ++i) {
            if (config.signers[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (config.signers[i] == config.signers[j]) revert DuplicateSigner();
            }
        }
        uint256 maxDeadline = block.timestamp + MAX_CIRCLE_DURATION;
        for (uint256 i; i < config.roundCount; ++i) {
            if (config.roundRecipients[i] == address(0) || config.roundPayouts[i] == 0) revert InvalidRound();
            if (config.roundContributionDeadlines[i] >= config.roundPayoutDeadlines[i]) revert InvalidDeadline();
            if (config.roundPayoutDeadlines[i] > maxDeadline) revert InvalidDeadline();
            if (uint256(config.roundPayoutDeadlines[i]) + RECOVERY_GRACE_PERIOD > type(uint48).max) {
                revert InvalidDeadline();
            }
            if (uint256(config.roundPayouts[i]) != uint256(config.contributionAmount) * config.members.length) {
                revert InvalidRound();
            }
        }
    }
}
