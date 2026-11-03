// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CircleTestBase} from "./CircleFactory.t.sol";
import {ICircleVault} from "../ICircleVault.sol";
import {FalseReturningERC20, RevertingERC20} from "../test-helpers/AdversarialERC20.sol";
import {Vm} from "forge-std/Vm.sol";

contract CircleVaultTest is CircleTestBase {
    event MetadataHashUpdated(bytes32 indexed previousHash, bytes32 indexed newHash);

    function test_MetadataUpdateEmitsAuditEvent() public {
        bytes32 nextHash = keccak256("new description");
        vm.expectEmit(true, true, false, true, address(vault));
        emit MetadataHashUpdated(bytes32(0), nextHash);
        vm.prank(admin);
        vault.setMetadataHash(nextHash);
    }

    function test_DraftInvitationsAreCreatorOnly() public {
        vm.prank(outsider);
        vm.expectRevert();
        vault.inviteMember(outsider);
        vm.prank(admin);
        vault.inviteMember(outsider);
        assertTrue(vault.isMember(outsider));
    }

    function test_AcceptanceRequiresMemberAndExactTerms() public {
        bytes32 terms = vault.termsHash();
        vm.prank(outsider);
        vm.expectRevert();
        vault.acceptTerms(terms);
        vm.prank(alice);
        vm.expectRevert();
        vault.acceptTerms(bytes32(uint256(1)));
        vm.prank(alice);
        vault.acceptTerms(terms);
        vm.prank(admin);
        vm.expectRevert();
        vault.activate();
    }

    function test_ActivationRequiresCreatorAndAllAcceptances() public {
        _acceptAll();
        vm.prank(outsider);
        vm.expectRevert();
        vault.activate();
        vm.prank(admin);
        vault.activate();
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Active));
    }

    function test_ActiveTermsAndMembershipCannotChange() public {
        bytes32 beforeTerms = vault.termsHash();
        ICircleVault.Round memory beforeRound = vault.round(0);
        _activate();
        vm.prank(admin);
        vault.setMetadataHash(keccak256("new description"));
        vm.prank(admin);
        vm.expectRevert();
        vault.inviteMember(outsider);
        assertEq(vault.termsHash(), beforeTerms);
        assertEq(abi.encode(vault.round(0)), abi.encode(beforeRoundWithStatus(beforeRound, vault.round(0).status)));
    }

    function test_DraftInvitationRefreshesTermsAndInvalidatesPriorAcceptances() public {
        _acceptAll();
        bytes32 beforeInvite = vault.termsHash();
        assertTrue(vault.hasAcceptedTerms(alice));
        assertTrue(vault.hasAcceptedTerms(bob));
        assertTrue(vault.hasAcceptedTerms(carol));

        vm.prank(admin);
        vault.inviteMember(outsider);
        bytes32 afterInvite = vault.termsHash();
        ICircleVault.CircleConfig memory updated = config;
        updated.members = new address[](4);
        updated.members[0] = alice;
        updated.members[1] = bob;
        updated.members[2] = carol;
        updated.members[3] = outsider;
        updated = _recommit(updated);
        assertEq(afterInvite, updated.termsHash);
        assertTrue(afterInvite != beforeInvite);
        assertTrue(vault.isMember(outsider));
        assertFalse(vault.hasAcceptedTerms(alice));
        assertFalse(vault.hasAcceptedTerms(bob));
        assertFalse(vault.hasAcceptedTerms(carol));
        assertFalse(vault.hasAcceptedTerms(outsider));

        vm.prank(alice);
        vm.expectRevert();
        vault.acceptTerms(beforeInvite);
        vm.prank(admin);
        vm.expectRevert();
        vault.activate();

        _acceptAllWith(afterInvite);
        vm.prank(admin);
        vm.expectRevert();
        vault.activate();
        vm.prank(outsider);
        vault.acceptTerms(afterInvite);
        vm.prank(admin);
        vault.activate();
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Active));
    }

    function test_R1UnderfundedRecoveryEmitsExactEventsAndNoRejectedEligibilityEvent() public {
        _activate();
        _contribute(alice);
        vm.warp(vault.round(0).contributionDeadline);
        vm.recordLogs();
        vm.prank(outsider);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        Vm.Log[] memory rejected = vm.getRecordedLogs();
        assertEq(rejected.length, 0);

        vm.warp(block.timestamp + 1);
        uint64 expectedEpoch = vault.recoveryEpoch() + 1;
        vm.recordLogs();
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool eligible;
        bool activated;
        bool roundTerminated;
        bool circleTerminated;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("RoundRecoveryEligible(uint256,uint48,uint128,uint128,bool)")) {
                assertEq(logs[i].emitter, address(vault));
                eligible = true;
                assertEq(uint256(logs[i].topics[1]), 0);
                (uint48 at, uint128 escrowed, uint128 required, bool fullyFunded) =
                    abi.decode(logs[i].data, (uint48, uint128, uint128, bool));
                assertEq(at, uint48(block.timestamp));
                assertEq(escrowed, CONTRIBUTION);
                assertEq(required, PAYOUT);
                assertFalse(fullyFunded);
            } else if (logs[i].topics[0] == keccak256("RoundRecoveryActivated(uint256,uint64,uint128,uint128)")) {
                assertEq(logs[i].emitter, address(vault));
                activated = true;
                assertEq(uint256(logs[i].topics[1]), 0);
                assertEq(uint64(uint256(logs[i].topics[2])), expectedEpoch);
                (uint128 escrowed, uint128 refundable) = abi.decode(logs[i].data, (uint128, uint128));
                assertEq(escrowed, CONTRIBUTION);
                assertEq(refundable, CONTRIBUTION);
            } else if (logs[i].topics[0] == keccak256("RoundTerminated(uint256,uint128,uint64)")) {
                assertEq(logs[i].emitter, address(vault));
                roundTerminated = true;
                assertEq(uint256(logs[i].topics[1]), 0);
                (uint128 remaining, uint64 epoch) = abi.decode(logs[i].data, (uint128, uint64));
                assertEq(remaining, CONTRIBUTION);
                assertEq(epoch, expectedEpoch);
            } else if (logs[i].topics[0] == keccak256("CircleTerminated(uint256,uint256,uint64)")) {
                assertEq(logs[i].emitter, address(vault));
                circleTerminated = true;
                assertEq(uint256(logs[i].topics[1]), vault.circleId());
                assertEq(uint256(logs[i].topics[2]), 0);
                assertEq(uint64(uint256(logs[i].topics[3])), expectedEpoch);
            }
        }
        assertTrue(eligible);
        assertTrue(activated);
        assertTrue(roundTerminated);
        assertTrue(circleTerminated);
        assertEq(vault.recoveryEpoch(), expectedEpoch);
        assertEq(vault.roundEscrowed(0), CONTRIBUTION);
        assertEq(vault.round(0).refunded, 0);
        _assertConservation();
    }

    function test_R1FullyFundedRecoveryInvalidatesProposalAndRefundEventsTrackEscrow() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        uint64 expectedEpoch = vault.recoveryEpoch() + 1;
        vm.recordLogs();
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool eligible;
        bool invalidated;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("RoundRecoveryEligible(uint256,uint48,uint128,uint128,bool)")) {
                assertEq(logs[i].emitter, address(vault));
                eligible = true;
                assertEq(uint256(logs[i].topics[1]), 0);
                (uint48 at, uint128 escrowed, uint128 required, bool fullyFunded) =
                    abi.decode(logs[i].data, (uint48, uint128, uint128, bool));
                assertEq(at, uint48(block.timestamp));
                assertEq(escrowed, PAYOUT);
                assertEq(required, PAYOUT);
                assertTrue(fullyFunded);
            } else if (logs[i].topics[0] == keccak256("PayoutProposalInvalidated(bytes32,uint256,uint64)")) {
                assertEq(logs[i].emitter, address(vault));
                invalidated = true;
                assertEq(logs[i].topics[1], id);
                assertEq(uint256(logs[i].topics[2]), 0);
                assertEq(uint64(uint256(logs[i].topics[3])), expectedEpoch);
            }
        }
        assertTrue(eligible);
        assertTrue(invalidated);
        assertEq(vault.recoveryEpoch(), expectedEpoch);
        assertEq(vault.roundEscrowed(0), PAYOUT);

        vm.recordLogs();
        vm.prank(alice);
        vault.refundContribution(0);
        logs = vm.getRecordedLogs();
        bool refunded;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != keccak256("ContributionRefunded(uint256,address,uint128,uint128,uint256)")) {
                continue;
            }
            assertEq(logs[i].emitter, address(vault));
            refunded = true;
            assertEq(uint256(logs[i].topics[1]), 0);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), alice);
            (uint128 amount, uint128 remaining, uint256 total) = abi.decode(logs[i].data, (uint128, uint128, uint256));
            assertEq(amount, CONTRIBUTION);
            assertEq(remaining, PAYOUT - CONTRIBUTION);
            assertEq(total, CONTRIBUTION);
        }
        assertTrue(refunded);
        assertEq(vault.roundEscrowed(0), PAYOUT - CONTRIBUTION);
        assertEq(vault.round(0).refunded, CONTRIBUTION);
        _assertConservation();
    }

    function beforeRoundWithStatus(ICircleVault.Round memory r, ICircleVault.RoundStatus status_)
        internal
        pure
        returns (ICircleVault.Round memory)
    {
        r.status = status_;
        return r;
    }

    function test_CreatorCannotBypassFinancialAuthorization() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        assertFalse(policy.isSigner(admin));
        vm.startPrank(admin);
        vm.expectRevert();
        policy.approvePayout(id);
        vm.expectRevert();
        vault.executePayout(id);
        vm.expectRevert();
        vault.executeAutomaticPayout(0);
        vm.expectRevert();
        vault.pause();
        vm.expectRevert();
        vault.unpause();
        vm.expectRevert();
        vault.cancelCircle(bytes32(0));
        vm.expectRevert();
        vault.refundContribution(0);
        address[] memory next = config.signers;
        vm.expectRevert();
        policy.proposeSignerSet(next, 2);
        vm.stopPrank();
        assertEq(vault.totalEscrowed(), PAYOUT);
        assertEq(token.balanceOf(admin), 0);
    }

    function test_OnlyCreatorCanCancelDraftWithoutLiabilities() public {
        vm.prank(outsider);
        vm.expectRevert();
        vault.cancelCircle(keccak256("cancel"));
        vm.prank(alice);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
        vm.prank(admin);
        vault.cancelCircle(keccak256("cancel"));
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Cancelled));
        assertEq(vault.totalDeposited(), 0);
        _assertConservation();
        vm.prank(admin);
        vm.expectRevert();
        vault.activate();
    }

    function test_ContributionsAreExactMemberOnlyAndSingleUse() public {
        _activate();
        vm.prank(outsider);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
        vm.prank(alice);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION - 1);
        _contribute(alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
        vm.prank(bob);
        vm.expectRevert();
        vault.contribute(1, CONTRIBUTION);
        assertEq(vault.contributedByMember(0, alice), CONTRIBUTION);
        assertEq(vault.totalDeposited(), CONTRIBUTION);
        _assertConservation();
    }

    function test_ContributionAtDeadlineSucceedsButNextSecondFails() public {
        _activate();
        vm.warp(vault.round(0).contributionDeadline);
        _contribute(alice);
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
    }

    function test_UnderfundedRecoveryStrictlyAfterDeadlineChangesNoAccounting() public {
        _activate();
        _contribute(alice);
        vm.warp(vault.round(0).contributionDeadline);
        vm.prank(outsider);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        vm.warp(block.timestamp + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        assertEq(uint256(vault.status()), uint256(ICircleVault.CircleStatus.Terminated));
        assertEq(uint256(vault.round(0).status), uint256(ICircleVault.RoundStatus.Recovery));
        assertEq(vault.totalDeposited(), CONTRIBUTION);
        assertEq(vault.totalEscrowed(), CONTRIBUTION);
        assertEq(vault.totalRefunded(), 0);
        assertEq(vault.roundEscrowed(0), CONTRIBUTION);
        _assertConservation();
    }

    function test_ProtectedPayoutWinsAtExact72HourBoundary() public {
        _activate();
        _fund();
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE - 1);
        bytes32 id = _propose();
        _approve(id);
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE);
        vm.recordLogs();
        vm.prank(outsider);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        assertEq(vm.getRecordedLogs().length, 0);
        uint256 beforeBalance = token.balanceOf(alice);
        vm.prank(outsider);
        vault.executePayout(id);
        assertEq(token.balanceOf(alice) - beforeBalance, PAYOUT);
        assertEq(vault.totalPaid(), PAYOUT);
        vm.expectRevert();
        vault.executePayout(id);
        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        vm.prank(alice);
        vm.expectRevert();
        vault.refundContribution(0);
        _assertConservation();
    }

    function test_FullyFundedRecoveryAfterBoundaryInvalidatesQuorumAndTerminates() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        _approve(id);
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        vm.expectRevert();
        vault.executePayout(id);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        assertFalse(policy.isPayoutApproved(id));
        vm.expectRevert();
        vault.executePayout(id);
        vm.prank(carol);
        vm.expectRevert();
        policy.approvePayout(id);
        vm.prank(bob);
        vm.expectRevert();
        vault.contribute(1, CONTRIBUTION);
        vm.prank(admin);
        vm.expectRevert();
        vault.proposePayout(1);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        assertEq(vault.totalEscrowed(), PAYOUT);
        assertEq(vault.totalRefunded(), 0);
        _assertConservation();
    }

    function test_QuorumLossStillAllowsIndefiniteExactContributorRefunds() public {
        _activate();
        _fund();
        _propose(); // No signer cooperates.
        _recoverFunded();
        vm.prank(admin);
        vm.expectRevert();
        vault.refundContribution(0);
        vm.warp(block.timestamp + 3650 days);
        address[3] memory order = [carol, alice, bob];
        for (uint256 i; i < order.length; ++i) {
            uint256 beforeBalance = token.balanceOf(order[i]);
            vm.prank(order[i]);
            vault.refundContribution(0);
            assertEq(token.balanceOf(order[i]) - beforeBalance, CONTRIBUTION);
            assertEq(vault.refundedByMember(0, order[i]), CONTRIBUTION);
            assertEq(vault.round(0).refunded, CONTRIBUTION * (i + 1));
            assertEq(vault.roundEscrowed(0), CONTRIBUTION * (2 - i));
            vm.prank(order[i]);
            vm.expectRevert();
            vault.refundContribution(0);
            _assertConservation();
        }
        assertEq(vault.totalEscrowed(), 0);
        assertEq(vault.totalRefunded(), PAYOUT);
        assertEq(vault.totalPaid(), 0);
        assertEq(vault.roundEscrowed(0), 0);
    }

    function test_EmptyRoundRecoveryCreatesNoRefundEntitlement() public {
        _activate();
        vm.warp(uint256(vault.round(0).contributionDeadline) + 1);
        vault.activateRoundRecovery(0);
        vm.prank(alice);
        vm.expectRevert();
        vault.refundContribution(0);
        assertEq(vault.totalDeposited(), 0);
        _assertConservation();
    }

    function test_PausingCannotBlockPermissionlessRecoveryOrRefunds() public {
        _activate();
        _fund();
        _pauseViaPolicy();
        _recoverFunded();
        vm.prank(alice);
        vault.refundContribution(0);
        assertEq(vault.totalRefunded(), CONTRIBUTION);
        _assertConservation();
    }

    function test_ExpiredProposalCannotExecuteOrChangeItsConsumedNonce() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        uint256 nonce = vault.proposal(id).proposalNonce;
        vm.warp(uint256(vault.proposal(id).expiresAt) + 1);
        vm.expectRevert();
        vault.executePayout(id);
        vault.expireProposal(id);
        assertEq(vault.totalEscrowed(), PAYOUT);
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        // Expiry is tested separately; R1 recovery now occurs beyond its exact boundary.
        vault.activateRoundRecovery(0);
        assertEq(vault.proposal(id).proposalNonce, nonce);
        _assertConservation();
    }

    function test_PostPayoutDefaultRefundsOnlyTheUnpaidRound() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        _approve(id);
        vault.executePayout(id);
        vm.prank(bob);
        vault.contribute(1, CONTRIBUTION);
        vm.warp(uint256(vault.round(1).contributionDeadline) + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(1);
        vm.prank(bob);
        vault.refundContribution(1);
        vm.prank(bob);
        vm.expectRevert();
        vault.refundContribution(0);
        assertEq(vault.totalDeposited(), 4e6);
        assertEq(vault.totalPaid(), 3e6);
        assertEq(vault.totalRefunded(), 1e6);
        assertEq(vault.totalEscrowed(), 0);
        _assertConservation();
    }

    function test_FailedContributionsAndRefundsRollBackAccounting() public {
        _activate();
        bytes memory originalCode = USDC.code;
        FalseReturningERC20 falseToken = new FalseReturningERC20();
        RevertingERC20 revertingToken = new RevertingERC20();
        vm.etch(USDC, address(falseToken).code);
        vm.prank(alice);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
        assertEq(vault.totalDeposited(), 0);
        assertEq(vault.contributedByMember(0, alice), 0);
        vm.etch(USDC, address(revertingToken).code);
        vm.prank(alice);
        vm.expectRevert();
        vault.contribute(0, CONTRIBUTION);
        assertEq(vault.totalEscrowed(), 0);
        vm.etch(USDC, originalCode);
        _fund();
        _recoverFunded();
        vm.etch(USDC, address(falseToken).code);
        vm.prank(alice);
        vm.expectRevert();
        vault.refundContribution(0);
        assertEq(vault.totalEscrowed(), PAYOUT);
        assertEq(vault.totalRefunded(), 0);
        assertEq(vault.refundedByMember(0, alice), 0);
        vm.etch(USDC, originalCode);
        vm.prank(alice);
        vault.refundContribution(0);
        _assertConservation();
    }

    function test_FailedPayoutTransferRollsBackSettlementState() public {
        _activate();
        _fund();
        bytes32 id = _propose();
        _approve(id);

        bytes memory originalCode = USDC.code;
        FalseReturningERC20 falseToken = new FalseReturningERC20();
        vm.etch(USDC, address(falseToken).code);
        vm.prank(outsider);
        vm.expectRevert();
        vault.executePayout(id);

        assertFalse(vault.proposal(id).executed);
        assertFalse(vault.round(0).paid);
        assertEq(vault.totalPaid(), 0);
        assertEq(vault.totalEscrowed(), PAYOUT);

        vm.etch(USDC, originalCode);
        _assertConservation();
        vm.prank(outsider);
        vault.executePayout(id);
        assertTrue(vault.proposal(id).executed);
        assertTrue(vault.round(0).paid);
        assertEq(vault.totalPaid(), PAYOUT);
        _assertConservation();
    }

    function test_PausedUnderfundedRoundStillRecoversAndRefunds() public {
        _activate();
        _contribute(alice);
        _pauseViaPolicy();
        vm.warp(uint256(vault.round(0).contributionDeadline) + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
        vm.prank(alice);
        vault.refundContribution(0);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(vault.totalRefunded(), CONTRIBUTION);
        _assertConservation();
    }

    function _pauseViaPolicy() internal {
        vm.prank(alice);
        bytes32 id = policy.proposePause(true);
        vm.prank(alice);
        policy.approvePause(id);
        vm.prank(bob);
        policy.approvePause(id);
        vm.prank(outsider);
        policy.executePause(id);
    }

    function test_UnsolicitedTokensAreSurplusNotMemberLiabilities() public {
        token.mint(address(vault), 19e6);
        assertEq(vault.totalDeposited(), 0);
        assertEq(vault.totalEscrowed(), 0);
        _activate();
        _contribute(alice);
        assertEq(vault.totalDeposited(), CONTRIBUTION);
        assertEq(token.balanceOf(address(vault)), 20e6);
        _assertConservation();
    }
}

contract CircleAutomaticVaultTest is CircleTestBase {
    function _config() internal view override returns (ICircleVault.CircleConfig memory c) {
        c = super._config();
        c.settlementMode = ICircleVault.SettlementMode.Automatic;
        c = _recommit(c);
    }

    function test_AutomaticSettlementCannotPayAnUnderfundedRound() public {
        _activate();
        _contribute(alice);
        vm.expectRevert();
        vault.executeAutomaticPayout(0);
        assertEq(vault.totalPaid(), 0);
        _assertConservation();
    }

    function test_AutomaticPayoutAlsoWinsAtExactRecoveryBoundary() public {
        _activate();
        _fund();
        vm.warp(uint256(vault.round(0).payoutDeadline) + 72 hours);
        vm.expectRevert();
        vault.activateRoundRecovery(0);
        uint256 beforeBalance = token.balanceOf(alice);
        vm.prank(outsider);
        vault.executeAutomaticPayout(0);
        assertEq(token.balanceOf(alice) - beforeBalance, PAYOUT);
        assertEq(vault.totalPaid(), PAYOUT);
        vm.expectRevert();
        vault.executeAutomaticPayout(0);
        _assertConservation();
    }
}
