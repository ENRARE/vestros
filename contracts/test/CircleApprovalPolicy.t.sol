// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CircleTestBase} from "./CircleFactory.t.sol";
import {ICircleVault} from "../ICircleVault.sol";
import {ICircleApprovalPolicy} from "../ICircleApprovalPolicy.sol";
import {Vm} from "forge-std/Vm.sol";

contract CircleApprovalPolicyTest is CircleTestBase {
    // Canonical type string proposed for the spec's PAYOUT_PROPOSAL_TYPEHASH.
    // Field order and widths are explicit; changing any domain field changes ID.
    bytes32 internal constant PAYOUT_TYPEHASH = keccak256(
        "PayoutProposal(uint256 chainId,address circleVault,address policy,uint256 circleId,uint256 roundId,address recipient,uint128 amount,uint256 proposalNonce,uint48 expiresAt,bytes32 termsHash,uint64 signerSetVersion)"
    );

    function test_PauseGovernanceRequiresSignerQuorumAndNoCreatorBypass() public {
        _activate();
        vm.prank(alice);
        bytes32 id = policy.proposePause(true);
        assertEq(uint256(policy.pauseProposalStatus(id)), uint256(ICircleApprovalPolicy.ProposalStatus.Pending));
        vm.prank(admin);
        vm.expectRevert();
        vault.pause();
        vm.prank(outsider);
        vm.expectRevert();
        policy.executePause(id);

        vm.prank(alice);
        policy.approvePause(id);
        assertFalse(policy.isPauseApproved(id));
        vm.prank(outsider);
        vm.expectRevert();
        policy.executePause(id);

        vm.prank(bob);
        policy.approvePause(id);
        assertTrue(policy.isPauseApproved(id));
        vm.prank(outsider);
        policy.executePause(id);
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Paused));
    }

    function test_UnpauseGovernanceRequiresFreshQuorum() public {
        _activate();
        bytes32 pauseId = _pauseViaGovernance();
        assertEq(uint256(policy.pauseProposalStatus(pauseId)), uint256(ICircleApprovalPolicy.ProposalStatus.Executed));

        vm.prank(alice);
        bytes32 unpauseId = policy.proposePause(false);
        vm.prank(alice);
        policy.approvePause(unpauseId);
        vm.prank(bob);
        policy.approvePause(unpauseId);
        vm.prank(outsider);
        policy.executePause(unpauseId);
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Active));
        assertEq(uint256(policy.pauseProposalStatus(unpauseId)), uint256(ICircleApprovalPolicy.ProposalStatus.Executed));
    }

    function test_ExpiredPauseGovernanceCannotExecuteOrReplay() public {
        _activate();
        vm.prank(alice);
        bytes32 id = policy.proposePause(true);
        ICircleApprovalPolicy.GovernanceProposal memory p = policy.pauseProposal(id);
        vm.prank(alice);
        policy.approvePause(id);
        vm.warp(uint256(p.expiresAt) + 1);
        assertEq(uint256(policy.pauseProposalStatus(id)), uint256(ICircleApprovalPolicy.ProposalStatus.Expired));
        vm.prank(outsider);
        vm.expectRevert();
        policy.executePause(id);
        policy.invalidatePauseProposal(id);
        assertEq(uint256(policy.pauseProposalStatus(id)), uint256(ICircleApprovalPolicy.ProposalStatus.Invalidated));
        vm.expectRevert();
        policy.invalidatePauseProposal(id);
        vm.expectRevert();
        policy.executePause(id);
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Active));
    }

    function test_OldSignerSetApprovalsCannotExecutePause() public {
        _activate();
        vm.prank(alice);
        bytes32 pauseId = policy.proposePause(true);
        vm.prank(alice);
        policy.approvePause(pauseId);
        vm.prank(bob);
        policy.approvePause(pauseId);

        address[] memory next = config.signers;
        next[2] = outsider;
        vm.prank(alice);
        bytes32 change = policy.proposeSignerSet(next, 2);
        vm.prank(alice);
        policy.approveSignerSet(change);
        vm.prank(bob);
        policy.approveSignerSet(change);
        vm.warp(uint256(policy.signerSetChange(change).executeAfter));
        policy.executeSignerSet(change);

        assertEq(uint256(policy.pauseProposalStatus(pauseId)), uint256(ICircleApprovalPolicy.ProposalStatus.Stale));
        vm.expectRevert();
        policy.executePause(pauseId);
        vm.prank(outsider);
        vm.expectRevert();
        policy.approvePause(pauseId);
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Active));
    }

    function test_RecoveryInvalidatesPauseAndPayoutEffectiveStatus() public {
        _activate();
        _contribute(alice);
        vm.prank(alice);
        bytes32 pauseId = policy.proposePause(true);
        vm.warp(uint256(vault.round(0).contributionDeadline) + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        assertEq(uint256(policy.pauseProposalStatus(pauseId)), uint256(ICircleApprovalPolicy.ProposalStatus.Stale));
        vm.expectRevert();
        policy.executePause(pauseId);
    }

    function test_RecoveryMakesPayoutEffectiveStatusInvalidated() public {
        _activate();
        _fund();
        bytes32 payoutId = _propose();
        _approve(payoutId);
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        assertFalse(policy.isPayoutApproved(payoutId));
        assertEq(
            uint256(policy.payoutProposalStatus(payoutId)), uint256(ICircleApprovalPolicy.ProposalStatus.Invalidated)
        );
        vm.expectRevert();
        vault.executePayout(payoutId);
    }

    function test_RecoveryMakesOlderPayoutStatusStaleWithoutHistoryIteration() public {
        _activate();
        _fund();
        bytes32 olderPayoutId = _propose();
        vm.prank(admin);
        bytes32 latestPayoutId = vault.proposePayout(0);

        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);

        assertEq(
            uint256(policy.payoutProposalStatus(olderPayoutId)), uint256(ICircleApprovalPolicy.ProposalStatus.Stale)
        );
        assertEq(
            uint256(policy.payoutProposalStatus(latestPayoutId)),
            uint256(ICircleApprovalPolicy.ProposalStatus.Invalidated)
        );
        vm.expectRevert();
        vault.executePayout(olderPayoutId);
        vm.expectRevert();
        vault.executePayout(latestPayoutId);
    }

    function test_PausedRecoveryAndRefundRemainPermissionless() public {
        _activate();
        _contribute(alice);
        _pauseViaGovernance();
        vm.warp(uint256(vault.round(0).contributionDeadline) + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        vm.prank(alice);
        vault.refundContribution(0);
        assertEq(vault.totalRefunded(), CONTRIBUTION);
        assertEq(vault.totalEscrowed(), 0);
    }

    function test_PauseTemporarilySuspendsButDoesNotInvalidateApprovedPayout() public {
        _activate();
        _fund();
        bytes32 payoutId = _propose();
        _approve(payoutId);
        assertEq(uint256(policy.payoutProposalStatus(payoutId)), uint256(ICircleApprovalPolicy.ProposalStatus.Approved));

        _pauseViaGovernance();
        assertEq(
            uint256(policy.payoutProposalStatus(payoutId)), uint256(ICircleApprovalPolicy.ProposalStatus.Ineligible)
        );
        vm.expectRevert();
        vault.executePayout(payoutId);

        vm.prank(alice);
        bytes32 unpauseId = policy.proposePause(false);
        vm.prank(alice);
        policy.approvePause(unpauseId);
        vm.prank(bob);
        policy.approvePause(unpauseId);
        policy.executePause(unpauseId);
        assertEq(uint256(policy.payoutProposalStatus(payoutId)), uint256(ICircleApprovalPolicy.ProposalStatus.Approved));
        vault.executePayout(payoutId);
        assertTrue(vault.proposal(payoutId).executed);
    }

    function test_GovernanceHasNoArbitraryTargetOrTokenAuthority() public {
        _activate();
        (bool arbitraryCall,) = address(policy).call(abi.encodeWithSignature("execute(address,bytes)", USDC, ""));
        assertFalse(arbitraryCall);
        token.mint(address(vault), CONTRIBUTION);
        assertEq(token.balanceOf(address(vault)), CONTRIBUTION);
        assertEq(vault.totalDeposited(), 0);
        assertEq(vault.totalEscrowed(), 0);
    }

    function _pauseViaGovernance() internal returns (bytes32 id) {
        vm.prank(alice);
        id = policy.proposePause(true);
        vm.prank(alice);
        policy.approvePause(id);
        vm.prank(bob);
        policy.approvePause(id);
        vm.prank(outsider);
        policy.executePause(id);
    }

    function test_ProposalIdentityIncludesEveryAuthorizationField() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        ICircleVault.PayoutProposal memory p = vault.proposal(id);
        assertEq(p.roundId, 0);
        assertEq(p.recipient, alice);
        assertEq(p.amount, PAYOUT);
        assertEq(p.createdAt, block.timestamp);
        assertEq(p.termsHash, vault.termsHash());
        assertEq(p.signerSetVersion, policy.signerSetVersion());
        assertEq(p.signerSetHash, policy.signerSetHash());
        assertEq(p.threshold, 2);
        bytes32 expected = keccak256(
            abi.encode(
                PAYOUT_TYPEHASH,
                uint256(5042002),
                address(vault),
                address(policy),
                vault.circleId(),
                uint256(0),
                alice,
                uint128(3e6),
                p.proposalNonce,
                p.expiresAt,
                vault.termsHash(),
                p.signerSetVersion
            )
        );
        assertEq(id, expected);
    }

    function test_UniqueApprovalsEnforceTwoOfThreeAndPermissionlessExecution() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        vm.prank(outsider);
        vm.expectRevert();
        policy.approvePayout(id);
        vm.recordLogs();
        vm.prank(alice);
        policy.approvePayout(id);
        Vm.Log[] memory approvalLogs = vm.getRecordedLogs();
        bool approvalEvent;
        for (uint256 i; i < approvalLogs.length; ++i) {
            if (approvalLogs[i].topics[0] != keccak256("PayoutApproved(bytes32,address,uint64)")) continue;
            assertEq(approvalLogs[i].emitter, address(policy));
            assertEq(approvalLogs[i].topics[1], id);
            assertEq(address(uint160(uint256(approvalLogs[i].topics[2]))), alice);
            approvalEvent = true;
        }
        assertTrue(approvalEvent);
        assertEq(policy.approvalCount(id), 1);
        assertFalse(policy.isPayoutApproved(id));
        vm.prank(alice);
        vm.expectRevert();
        policy.approvePayout(id);
        vm.expectRevert();
        vault.executePayout(id);
        vm.prank(bob);
        policy.approvePayout(id);
        assertEq(policy.approvalCount(id), 2);
        assertTrue(policy.isPayoutApproved(id));
        vm.prank(outsider);
        vault.executePayout(id);
        assertTrue(vault.proposal(id).executed);
        vm.prank(carol);
        vm.expectRevert();
        policy.approvePayout(id);
    }

    function test_CreatorMayApproveOnlyWhenExplicitSigner() public {
        ICircleVault.CircleConfig memory c = config;
        c.signers[2] = admin;
        c = _recommit(c);
        ICircleVault other = _create(c);
        bytes32 terms = other.termsHash();
        address[3] memory members = [alice, bob, carol];
        for (uint256 i; i < members.length; ++i) {
            vm.startPrank(members[i]);
            other.acceptTerms(terms);
            token.approve(address(other), CONTRIBUTION);
            vm.stopPrank();
        }
        vm.prank(admin);
        other.activate();
        for (uint256 i; i < members.length; ++i) {
            vm.prank(members[i]);
            other.contribute(0, CONTRIBUTION);
        }
        vm.prank(admin);
        bytes32 id = other.proposePayout(0);
        ICircleApprovalPolicy otherPolicy = ICircleApprovalPolicy(other.policy());
        vm.prank(admin);
        otherPolicy.approvePayout(id);
        assertEq(otherPolicy.approvalCount(id), 1);
        assertFalse(otherPolicy.isPayoutApproved(id));
        vm.prank(admin);
        vm.expectRevert();
        other.executePayout(id);
    }

    function test_UnknownAndCrossVaultProposalsCannotReceiveApprovals() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        ICircleVault other = _create(config);
        ICircleApprovalPolicy otherPolicy = ICircleApprovalPolicy(other.policy());
        vm.prank(alice);
        vm.expectRevert();
        otherPolicy.approvePayout(id);
        vm.prank(alice);
        vm.expectRevert();
        policy.approvePayout(keccak256("nonexistent proposal"));
    }

    function test_ExpiredProposalRejectsApprovals() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        vm.warp(uint256(vault.proposal(id).expiresAt) + 1);
        vm.prank(alice);
        vm.expectRevert();
        policy.approvePayout(id);
        assertFalse(policy.isPayoutApproved(id));
    }

    function test_SignerReplacementRequiresOldQuorumAndInvalidatesOldProposals() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        _approve(id);
        uint64 oldVersion = policy.signerSetVersion();
        address[] memory next = config.signers;
        next[2] = outsider;
        vm.prank(alice);
        bytes32 change = policy.proposeSignerSet(next, 2);
        vm.prank(alice);
        policy.approveSignerSet(change);
        vm.expectRevert();
        policy.executeSignerSet(change);
        vm.prank(bob);
        policy.approveSignerSet(change);
        assertEq(policy.SIGNER_SET_CHANGE_DELAY(), SIGNER_SET_CHANGE_DELAY);
        vm.expectRevert();
        policy.executeSignerSet(change);
        uint48 executeAfter = policy.signerSetChange(change).executeAfter;
        assertEq(executeAfter, uint48(block.timestamp + SIGNER_SET_CHANGE_DELAY));
        vm.warp(executeAfter - 1);
        vm.expectRevert();
        policy.executeSignerSet(change);
        vm.warp(executeAfter);
        policy.executeSignerSet(change);
        assertEq(policy.signerSetVersion(), oldVersion + 1);
        assertFalse(policy.isSigner(carol));
        assertTrue(policy.isSigner(outsider));
        assertFalse(policy.isPayoutApproved(id));
        vm.prank(outsider);
        vm.expectRevert();
        policy.approvePayout(id);
        vm.expectRevert();
        vault.executePayout(id);
        policy.invalidateProposal(id);
        bytes32 fresh = _propose();
        assertTrue(fresh != id);
        assertGt(vault.proposal(fresh).proposalNonce, vault.proposal(id).proposalNonce);
        assertEq(policy.approvalCount(fresh), 0);
    }

    function test_ExpiredProposalCanBeReproposedWithFreshNonceAndOldApprovalStaysStale() public {
        _activate();
        _fund();
        bytes32 expired = _propose();
        uint256 expiredNonce = vault.proposal(expired).proposalNonce;
        vm.prank(alice);
        policy.approvePayout(expired);
        vm.warp(uint256(vault.proposal(expired).expiresAt) + 1);
        vm.prank(outsider);
        vault.expireProposal(expired);

        vm.prank(alice);
        vm.expectRevert();
        policy.approvePayout(expired);

        bytes32 replacement = _propose();
        assertTrue(replacement != expired);
        assertGt(vault.proposal(replacement).proposalNonce, expiredNonce);
        assertEq(policy.approvalCount(replacement), 0);
        vm.prank(alice);
        policy.approvePayout(replacement);
        assertEq(policy.approvalCount(expired), 1);
        assertEq(policy.approvalCount(replacement), 1);
    }

    function test_CompletedRoundCannotReuseNonceOrAcceptStaleApproval() public {
        _activate();
        _fund();
        bytes32 completed = _propose();
        uint256 completedNonce = vault.proposal(completed).proposalNonce;
        _approve(completed);
        vault.executePayout(completed);
        assertTrue(vault.proposal(completed).executed);
        assertEq(vault.nextProposalNonce(), completedNonce + 1);

        _contributeRound(1, alice);
        _contributeRound(1, bob);
        _contributeRound(1, carol);
        vm.prank(admin);
        bytes32 nextRound = vault.proposePayout(1);
        assertTrue(nextRound != completed);
        assertGt(vault.proposal(nextRound).proposalNonce, completedNonce);
        assertEq(vault.nextProposalNonce(), completedNonce + 2);
        assertEq(policy.approvalCount(nextRound), 0);
        vm.prank(outsider);
        vm.expectRevert();
        vault.executePayout(nextRound);

        vm.prank(admin);
        vm.expectRevert();
        vault.proposePayout(0);
        vm.prank(carol);
        vm.expectRevert();
        policy.approvePayout(completed);
        assertEq(vault.nextProposalNonce(), completedNonce + 2);
    }
}
