// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CircleTestBase} from "./CircleFactory.t.sol";
import {ICircleVault} from "../ICircleVault.sol";
import {ICircleApprovalPolicy} from "../ICircleApprovalPolicy.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Ghost counters follow successful token movement, independently of the
/// production liability counters. Invalid randomized actions may revert.
contract CircleHandler is Test {
    ICircleVault public vault;
    ICircleApprovalPolicy public policy;
    MockERC20 internal token;
    address internal admin;
    address[3] internal members;
    bytes32 public latestProposal;
    uint256 public deposited;
    uint256 public paid;
    uint256 public refunded;
    bool public terminated;
    uint256 public depositsAtTermination;
    mapping(uint256 => uint256) public payoutCount;
    mapping(uint256 => mapping(address => uint256)) public depositsBy;
    mapping(uint256 => mapping(address => uint256)) public refundsBy;

    constructor(ICircleVault v, MockERC20 t, address a, address[3] memory m) {
        vault = v;
        policy = ICircleApprovalPolicy(v.policy());
        token = t;
        admin = a;
        members = m;
        for (uint256 i; i < m.length; ++i) {
            vm.prank(m[i]);
            t.approve(address(v), type(uint256).max);
        }
    }

    function contribute(uint8 memberSeed, uint8 roundSeed) external {
        address member = members[uint256(memberSeed) % 3];
        uint256 roundId = uint256(roundSeed) % 2;
        uint256 beforeBalance = token.balanceOf(address(vault));
        vm.prank(member);
        try vault.contribute(roundId, 1e6) {
            uint256 received = token.balanceOf(address(vault)) - beforeBalance;
            deposited += received;
            depositsBy[roundId][member] += received;
        } catch {}
    }

    function propose(uint8 roundSeed) external {
        vm.prank(admin);
        try vault.proposePayout(uint256(roundSeed) % 2) returns (bytes32 id) {
            latestProposal = id;
        } catch {}
    }

    function approve(uint8 memberSeed) external {
        vm.prank(members[uint256(memberSeed) % 3]);
        try policy.approvePayout(latestProposal) {} catch {}
    }

    function execute() external {
        uint256 roundId = vault.proposal(latestProposal).roundId;
        uint256 beforeBalance = token.balanceOf(address(vault));
        try vault.executePayout(latestProposal) {
            paid += beforeBalance - token.balanceOf(address(vault));
            ++payoutCount[roundId];
        } catch {}
    }

    function advanceTime(uint32 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 0, 1 days));
    }

    function recover(uint8 roundSeed) external {
        try vault.activateRoundRecovery(uint256(roundSeed) % 2) {
            terminated = true;
            depositsAtTermination = deposited;
        } catch {}
    }

    function refund(uint8 memberSeed, uint8 roundSeed) external {
        address member = members[uint256(memberSeed) % 3];
        uint256 roundId = uint256(roundSeed) % 2;
        uint256 beforeBalance = token.balanceOf(member);
        vm.prank(member);
        try vault.refundContribution(roundId) {
            uint256 received = token.balanceOf(member) - beforeBalance;
            refunded += received;
            refundsBy[roundId][member] += received;
        } catch {}
    }
}

contract CircleInvariantsTest is CircleTestBase {
    CircleHandler internal handler;
    bytes32 internal initialTerms;

    function setUp() public override {
        super.setUp();
        _activate();
        initialTerms = vault.termsHash();
        handler = new CircleHandler(vault, token, admin, [alice, bob, carol]);
        // Seed a real liability so the invariant cannot pass on an empty vault.
        handler.contribute(0, 0);
        assertEq(vault.totalDeposited(), CONTRIBUTION);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.contribute.selector;
        selectors[1] = handler.propose.selector;
        selectors[2] = handler.approve.selector;
        selectors[3] = handler.execute.selector;
        selectors[4] = handler.advanceTime.selector;
        selectors[5] = handler.recover.selector;
        selectors[6] = handler.refund.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_ConservationAndSolvencyMatchObservedTransfers() public view {
        _assertConservation();
        assertEq(vault.totalDeposited(), handler.deposited());
        assertEq(vault.totalPaid(), handler.paid());
        assertEq(vault.totalRefunded(), handler.refunded());
        assertLe(handler.paid() + handler.refunded(), handler.deposited());
        assertEq(token.balanceOf(address(vault)), handler.deposited() - handler.paid() - handler.refunded());
    }

    function invariant_PayoutsAndRefundsAreMutuallyExclusiveAndSingleUse() public view {
        address[3] memory members = [alice, bob, carol];
        for (uint256 r; r < 2; ++r) {
            assertLe(handler.payoutCount(r), 1);
            for (uint256 i; i < members.length; ++i) {
                assertLe(handler.refundsBy(r, members[i]), handler.depositsBy(r, members[i]));
                assertEq(vault.contributedByMember(r, members[i]), handler.depositsBy(r, members[i]));
                assertEq(vault.refundedByMember(r, members[i]), handler.refundsBy(r, members[i]));
                if (vault.round(r).paid) assertEq(handler.refundsBy(r, members[i]), 0);
            }
        }
        assertEq(vault.termsHash(), initialTerms);
    }

    function invariant_ApprovalCountNeverExceedsUniqueSigners() public view {
        assertLe(policy.approvalCount(handler.latestProposal()), policy.signerCount());
        if (vault.status() == ICircleVault.CircleStatus.Terminated) {
            assertFalse(policy.isPayoutApproved(handler.latestProposal()));
        }
        if (handler.terminated()) assertEq(vault.totalDeposited(), handler.depositsAtTermination());
    }
}
