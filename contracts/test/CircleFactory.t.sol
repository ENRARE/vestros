// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ICircleFactory} from "../ICircleFactory.sol";
import {ICircleVault} from "../ICircleVault.sol";
import {ICircleApprovalPolicy} from "../ICircleApprovalPolicy.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {CircleFactory} from "../CircleFactory.sol";
import {CircleVault} from "../CircleVault.sol";

/// @dev Shared fixture stays in this approved test file. These concrete imports
/// intentionally fail until the subsequent implementation tasks supply them.
abstract contract CircleTestBase is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint128 internal constant CONTRIBUTION = 1e6;
    uint128 internal constant PAYOUT = 3e6;
    uint48 internal constant GRACE = 72 hours;
    uint256 internal constant MAX_MEMBERS = 32;
    uint256 internal constant MAX_SIGNERS = 16;
    uint256 internal constant MAX_ROUNDS = 32;
    uint48 internal constant MAX_CIRCLE_DURATION = 365 days;
    uint48 internal constant MAX_PROPOSAL_LIFETIME = 7 days;
    uint48 internal constant SIGNER_SET_CHANGE_DELAY = 24 hours;
    address internal admin = makeAddr("circle-admin");
    address internal alice = makeAddr("circle-alice");
    address internal bob = makeAddr("circle-bob");
    address internal carol = makeAddr("circle-carol");
    address internal outsider = makeAddr("circle-outsider");
    MockERC20 internal token;
    ICircleFactory internal factory;
    ICircleVault internal vault;
    ICircleApprovalPolicy internal policy;
    ICircleVault.CircleConfig internal config;

    function setUp() public virtual {
        vm.chainId(5042002);
        vm.warp(1_000_000);
        MockERC20 template = new MockERC20("Mock USDC", "USDC", 6);
        vm.etch(USDC, address(template).code);
        token = MockERC20(USDC);
        factory = ICircleFactory(address(new CircleFactory(USDC)));
        config = _config();
        vault = _create(config);
        policy = ICircleApprovalPolicy(vault.policy());
        address[3] memory members = [alice, bob, carol];
        for (uint256 i; i < members.length; ++i) {
            token.mint(members[i], 100e6);
            vm.prank(members[i]);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function _config() internal view virtual returns (ICircleVault.CircleConfig memory c) {
        c.creator = admin;
        c.members = new address[](3);
        c.members[0] = alice;
        c.members[1] = bob;
        c.members[2] = carol;
        c.signers = c.members;
        c.threshold = 2;
        c.settlementMode = ICircleVault.SettlementMode.Protected;
        c.contributionAmount = CONTRIBUTION;
        c.roundCount = 2;
        c.roundContributionDeadlines = new uint48[](2);
        c.roundPayoutDeadlines = new uint48[](2);
        c.roundContributionDeadlines[0] = uint48(block.timestamp + 1 days);
        c.roundPayoutDeadlines[0] = uint48(block.timestamp + 10 days);
        c.roundContributionDeadlines[1] = uint48(block.timestamp + 6 days);
        c.roundPayoutDeadlines[1] = uint48(block.timestamp + 20 days);
        c.roundRecipients = new address[](2);
        c.roundRecipients[0] = alice;
        c.roundRecipients[1] = bob;
        c.roundPayouts = new uint128[](2);
        c.roundPayouts[0] = PAYOUT;
        c.roundPayouts[1] = PAYOUT;
        c.proposalLifetime = MAX_PROPOSAL_LIFETIME;
        c = _recommit(c);
    }

    function _recommit(ICircleVault.CircleConfig memory c) internal pure returns (ICircleVault.CircleConfig memory) {
        // Exact spec rule: hash the complete config with termsHash zeroed.
        c.termsHash = bytes32(0);
        c.termsHash = keccak256(abi.encode(c));
        return c;
    }

    function _maximumConfig() internal view returns (ICircleVault.CircleConfig memory c) {
        c = config;
        c.members = new address[](MAX_MEMBERS);
        c.signers = new address[](MAX_SIGNERS);
        for (uint256 i; i < MAX_MEMBERS; ++i) {
            c.members[i] = address(uint160(0x1000 + i));
        }
        for (uint256 i; i < MAX_SIGNERS; ++i) {
            c.signers[i] = address(uint160(0x2000 + i));
        }
        c.threshold = uint16(MAX_SIGNERS / 2 + 1);
        c.roundCount = uint32(MAX_ROUNDS);
        c.roundContributionDeadlines = new uint48[](MAX_ROUNDS);
        c.roundPayoutDeadlines = new uint48[](MAX_ROUNDS);
        c.roundRecipients = new address[](MAX_ROUNDS);
        c.roundPayouts = new uint128[](MAX_ROUNDS);
        for (uint256 i; i < MAX_ROUNDS; ++i) {
            c.roundContributionDeadlines[i] = uint48(block.timestamp + 1 days + i * 1 days);
            c.roundPayoutDeadlines[i] = uint48(block.timestamp + 2 days + i * 1 days);
            c.roundRecipients[i] = c.members[i];
            c.roundPayouts[i] = uint128(MAX_MEMBERS) * CONTRIBUTION;
        }
        // Use the exact duration boundary on the final payout deadline.
        c.roundContributionDeadlines[MAX_ROUNDS - 1] = uint48(block.timestamp + MAX_CIRCLE_DURATION - 1);
        c.roundPayoutDeadlines[MAX_ROUNDS - 1] = uint48(block.timestamp + MAX_CIRCLE_DURATION);
        c.proposalLifetime = MAX_PROPOSAL_LIFETIME;
        c = _recommit(c);
    }

    function _create(ICircleVault.CircleConfig memory c) internal returns (ICircleVault) {
        vm.prank(c.creator);
        return ICircleVault(factory.createCircle(c));
    }

    function _activate() internal {
        _acceptAll();
        vm.prank(admin);
        vault.activate();
    }

    function _acceptAll() internal {
        address[3] memory members = [alice, bob, carol];
        bytes32 terms = vault.termsHash();
        for (uint256 i; i < members.length; ++i) {
            vm.prank(members[i]);
            vault.acceptTerms(terms);
        }
    }

    function _acceptAllWith(bytes32 terms) internal {
        address[3] memory members = [alice, bob, carol];
        for (uint256 i; i < members.length; ++i) {
            vm.prank(members[i]);
            vault.acceptTerms(terms);
        }
    }

    function _contribute(address member) internal {
        vm.prank(member);
        vault.contribute(0, CONTRIBUTION);
    }

    function _contributeRound(uint256 roundId, address member) internal {
        vm.prank(member);
        vault.contribute(roundId, CONTRIBUTION);
    }

    function _fund() internal {
        _contribute(alice);
        _contribute(bob);
        _contribute(carol);
    }

    function _propose() internal returns (bytes32 id) {
        vm.prank(admin);
        id = vault.proposePayout(0);
    }

    function _approve(bytes32 id) internal {
        vm.prank(alice);
        policy.approvePayout(id);
        vm.prank(bob);
        policy.approvePayout(id);
    }

    function _assertConservation() internal view {
        assertEq(vault.totalDeposited(), vault.totalEscrowed() + vault.totalPaid() + vault.totalRefunded());
        assertGe(token.balanceOf(address(vault)), vault.totalEscrowed());
    }

    function _recoverFunded() internal {
        vm.warp(uint256(vault.round(0).payoutDeadline) + GRACE + 1);
        vm.prank(outsider);
        vault.activateRoundRecovery(0);
    }
}

contract CircleFactoryTest is CircleTestBase {
    function test_FactoryRegistrationAndVaultProvenanceAreExplicit() public {
        assertTrue(factory.isCircle(address(vault)));
        assertEq(vault.factory(), address(factory));

        ICircleVault direct = ICircleVault(new CircleVault(USDC, 99, config));
        assertTrue(direct.factory() != address(factory));
        assertFalse(factory.isCircle(address(direct)));
    }

    function test_RegistersIndependentCirclesAndCreatorNonces() public {
        assertEq(factory.usdc(), USDC);
        assertEq(factory.circleCount(), 1);
        assertEq(factory.circleAt(0), address(vault));
        assertEq(factory.circleOf(admin, 0), address(vault));
        ICircleVault second = _create(config);
        assertTrue(address(second) != address(vault));
        assertEq(factory.circleOf(admin, 1), address(second));
        ICircleVault.CircleConfig memory other = config;
        other.creator = outsider;
        other = _recommit(other);
        ICircleVault third = _create(other);
        assertEq(factory.circleOf(outsider, 0), address(third));
        assertEq(third.creator(), outsider);
        assertEq(factory.circleCount(), 3);
    }

    function test_TermsHashUsesZeroedConfigCommitment() public view {
        ICircleVault.CircleConfig memory committed = config;
        bytes32 supplied = committed.termsHash;
        committed.termsHash = bytes32(0);
        assertEq(supplied, keccak256(abi.encode(committed)));
        assertEq(vault.termsHash(), supplied);
    }

    function test_FactoryCreationEventBindsRegisteredVault() public {
        vm.recordLogs();
        ICircleVault second = _create(config);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(factory) || logs[i].topics.length != 4) continue;
            if (logs[i].topics[0] != keccak256("CircleCreated(uint256,address,address)")) continue;
            assertEq(uint256(logs[i].topics[1]), second.circleId());
            assertEq(address(uint160(uint256(logs[i].topics[2]))), admin);
            assertEq(address(uint160(uint256(logs[i].topics[3]))), address(second));
            ++matches;
        }
        assertEq(matches, 1);
    }

    function test_RejectsZeroAndNoncanonicalUsdc() public {
        vm.expectRevert();
        new CircleFactory(address(0));
        vm.expectRevert();
        new CircleFactory(address(0xBAD));
    }

    function test_RejectsZeroCreator() public {
        ICircleVault.CircleConfig memory c = config;
        c.creator = address(0);
        c = _recommit(c);
        vm.expectRevert();
        new CircleVault(USDC, 99, c);
    }

    function test_RejectsCreatorImpersonation() public {
        vm.prank(outsider);
        vm.expectRevert();
        factory.createCircle(config);
        assertEq(factory.circleCount(), 1);
    }

    function test_RejectsDuplicateMembers() public {
        ICircleVault.CircleConfig memory c = config;
        c.members[1] = c.members[0];
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function test_RejectsDuplicateSigners() public {
        ICircleVault.CircleConfig memory c = config;
        c.signers[1] = c.signers[0];
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function testFuzz_RejectsZeroMinorityOrExcessThreshold(uint16 requested) public {
        vm.assume(requested != 2 && requested != 3);
        ICircleVault.CircleConfig memory c = config;
        c.threshold = requested;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function test_RejectsOversizedMemberAndSignerSets() public {
        ICircleVault.CircleConfig memory c = config;
        address[] memory oversized = new address[](MAX_MEMBERS + 1);
        for (uint256 i; i < oversized.length; ++i) {
            oversized[i] = address(uint160(i + 1));
        }
        c.members = oversized;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
        c = config;
        oversized = new address[](MAX_SIGNERS + 1);
        for (uint256 i; i < oversized.length; ++i) {
            oversized[i] = address(uint160(0x3000 + i));
        }
        c.signers = oversized;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function test_RejectsUnorderedDeadlinesAndRecoveryOverflow() public {
        ICircleVault.CircleConfig memory c = config;
        c.roundPayoutDeadlines[0] = c.roundContributionDeadlines[0] - 1;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
        c = config;
        c.roundPayoutDeadlines[1] = type(uint48).max;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function test_ApprovedBoundsAreExposedAndMaximumConfigIsAccepted() public {
        assertEq(factory.MAX_MEMBERS(), MAX_MEMBERS);
        assertEq(factory.MAX_SIGNERS(), MAX_SIGNERS);
        assertEq(factory.MAX_ROUNDS(), MAX_ROUNDS);
        assertEq(factory.MAX_CIRCLE_DURATION(), MAX_CIRCLE_DURATION);
        assertEq(factory.MAX_PROPOSAL_LIFETIME(), MAX_PROPOSAL_LIFETIME);
        assertEq(vault.RECOVERY_GRACE_PERIOD(), GRACE);
        assertEq(policy.SIGNER_SET_CHANGE_DELAY(), SIGNER_SET_CHANGE_DELAY);

        ICircleVault maximum = _create(_maximumConfig());
        assertEq(maximum.termsHash(), _maximumConfig().termsHash);
        assertEq(maximum.round(0).payoutDeadline, uint48(block.timestamp + 2 days));
        assertEq(maximum.round(MAX_ROUNDS - 1).payoutDeadline, uint48(block.timestamp + MAX_CIRCLE_DURATION));
    }

    function test_RejectsImmediatelyOutsideEveryApprovedBound() public {
        ICircleVault.CircleConfig memory c = _maximumConfig();

        c.members = new address[](MAX_MEMBERS + 1);
        for (uint256 i; i < c.members.length; ++i) {
            c.members[i] = address(uint160(0x4000 + i));
        }
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);

        c = _maximumConfig();
        c.signers = new address[](MAX_SIGNERS + 1);
        for (uint256 i; i < c.signers.length; ++i) {
            c.signers[i] = address(uint160(0x5000 + i));
        }
        c.threshold = uint16(c.signers.length / 2 + 1);
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);

        c = _maximumConfig();
        c.roundCount = uint32(MAX_ROUNDS + 1);
        c.roundContributionDeadlines = new uint48[](MAX_ROUNDS + 1);
        c.roundPayoutDeadlines = new uint48[](MAX_ROUNDS + 1);
        c.roundRecipients = new address[](MAX_ROUNDS + 1);
        c.roundPayouts = new uint128[](MAX_ROUNDS + 1);
        for (uint256 i; i < c.roundCount; ++i) {
            c.roundContributionDeadlines[i] = uint48(block.timestamp + 1 days + i);
            c.roundPayoutDeadlines[i] = uint48(block.timestamp + 2 days + i);
            c.roundRecipients[i] = c.members[i % MAX_MEMBERS];
            c.roundPayouts[i] = PAYOUT;
        }
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);

        c = _maximumConfig();
        c.roundPayoutDeadlines[MAX_ROUNDS - 1] = uint48(block.timestamp + MAX_CIRCLE_DURATION + 1);
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);

        c = _maximumConfig();
        c.proposalLifetime = MAX_PROPOSAL_LIFETIME + 1;
        c = _recommit(c);
        vm.prank(admin);
        vm.expectRevert();
        factory.createCircle(c);
    }

    function test_FactoryHasNoAdminOrWithdrawalAuthority() public {
        (bool owns,) = address(factory).staticcall(abi.encodeWithSignature("owner()"));
        assertFalse(owns);
        token.mint(address(factory), CONTRIBUTION);
        vm.prank(admin);
        (bool withdraws,) =
            address(factory).call(abi.encodeWithSignature("withdraw(address,uint256)", USDC, CONTRIBUTION));
        assertFalse(withdraws);
        assertEq(token.balanceOf(address(factory)), CONTRIBUTION);
        vm.prank(address(factory));
        vm.expectRevert();
        vault.pause();
    }

    function test_PolicyIsPermanentlyBoundToOriginatingVault() public {
        ICircleVault second = _create(config);
        assertEq(policy.circleVault(), address(vault));
        assertTrue(second.policy() != address(policy));
        vm.prank(admin);
        (bool rebound,) = address(policy).call(abi.encodeWithSignature("setCircleVault(address)", address(second)));
        assertFalse(rebound);
        assertEq(policy.circleVault(), address(vault));
    }
}
