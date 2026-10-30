// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable}  from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {USDCVesting} from "../USDCVesting.sol";
import {MockERC20}   from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Handler used by the invariant test suite
// ─────────────────────────────────────────────────────────────────────────────
contract VestingHandler is Test {
    USDCVesting public vesting;
    MockERC20   public usdc;
    address     public owner;

    // Ghost accounting: total USDC deposited into the contract by createSchedule
    uint256 public ghostDeposited;
    // Ghost accounting: total USDC sent out to beneficiaries via claim / revoke / rescue
    uint256 public ghostWithdrawn;

    // Keep a list of scheduleIds created through this handler
    uint256[] public scheduleIds;
    // Keep matching beneficiary addresses
    address[] public beneficiaries;

    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    uint256 private _callCount;

    constructor(USDCVesting _vesting, MockERC20 _usdc, address _owner) {
        vesting = _vesting;
        usdc    = _usdc;
        owner   = _owner;
    }

    /// @dev Create a schedule with bounded, valid parameters.
    function createSchedule(
        uint128 totalAmount,
        uint48  vestingDuration,
        uint48  cliffDuration
    ) external {
        totalAmount     = uint128(bound(totalAmount,     1,       1_000_000e6));
        vestingDuration = uint48 (bound(vestingDuration, 1,       365 days));
        cliffDuration   = uint48 (bound(cliffDuration,   0,       vestingDuration));

        // Deterministic beneficiary derived from call count
        address beneficiary = address(uint160(uint256(keccak256(abi.encode("ben", _callCount++)))));

        uint48 startTime = uint48(block.timestamp);

        // Mint and approve before calling createSchedule
        usdc.mint(owner, totalAmount);
        vm.prank(owner);
        usdc.approve(address(vesting), totalAmount);

        vm.prank(owner);
        try vesting.createSchedule(beneficiary, totalAmount, cliffDuration, vestingDuration, startTime) {
            uint256 newId = scheduleIds.length == 0
                ? 0
                : scheduleIds[scheduleIds.length - 1] + 1;
            scheduleIds.push(newId);
            beneficiaries.push(beneficiary);
            ghostDeposited += totalAmount;
        } catch {
            // If it reverts for any reason, undo the mint so ghost accounting stays clean
            // (we can't un-mint easily, so just note the revert)
        }
    }

    /// @dev Claim on a random existing schedule.
    function claim(uint256 idxSeed) external {
        if (scheduleIds.length == 0) return;
        uint256 idx        = idxSeed % scheduleIds.length;
        uint256 scheduleId = scheduleIds[idx];
        address ben        = beneficiaries[idx];

        uint128 claimable = vesting.claimableAmount(scheduleId);
        if (claimable == 0) return;

        vm.prank(ben);
        try vesting.claim(scheduleId) {
            ghostWithdrawn += claimable;
        } catch {}
    }

    /// @dev Revoke a random existing schedule.
    function revoke(uint256 idxSeed) external {
        if (scheduleIds.length == 0) return;
        uint256 idx        = idxSeed % scheduleIds.length;
        uint256 scheduleId = scheduleIds[idx];

        USDCVesting.VestingSchedule memory s = vesting.getSchedule(scheduleId);
        if (s.revoked) return;
        if (s.claimedAmount == s.totalAmount) return;

        uint128 unvested = s.totalAmount - vesting.vestedAmount(scheduleId, block.timestamp);

        vm.prank(owner);
        try vesting.revoke(scheduleId) {
            ghostWithdrawn += unvested;
        } catch {}
    }

    /// @dev Warp time forward by a small amount so vesting progresses.
    function warpTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 30 days);
        skip(seconds_);
    }

    function schedulesCount() external view returns (uint256) {
        return scheduleIds.length;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract
// ─────────────────────────────────────────────────────────────────────────────
contract USDCVestingTest is Test {
    // ── addresses ───────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    address internal owner   = makeAddr("owner");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal charlie = makeAddr("charlie");

    // ── contracts ───────────────────────────────────────────────────────────
    USDCVesting internal vesting;
    MockERC20   internal usdc;

    // ── constants ───────────────────────────────────────────────────────────
    uint128 internal constant AMOUNT       = 1_000e6;     // 1 000 USDC (6 dp)
    uint48  internal constant VESTING_DUR  = 365 days;
    uint48  internal constant CLIFF_DUR    = 90 days;
    uint256 internal constant T0           = 1_000_000;   // arbitrary genesis timestamp

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        // Pin chain time so startTime checks are predictable
        vm.warp(T0);

        // Deploy mock at a throwaway address, then etch it to the canonical USDC address
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mock).code);
        usdc = MockERC20(USDC_ADDR);

        // Deploy vesting contract (constructor: address _initialOwner)
        vm.prank(owner);
        vesting = new USDCVesting(owner);

        // Seed owner with USDC and pre-approve for all tests
        usdc.mint(owner, 100_000_000e6);
        vm.prank(owner);
        usdc.approve(address(vesting), type(uint256).max);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 1 — Deployment & initialization
    // ═════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsOwner() public view {
        assertEq(vesting.owner(), owner);
    }

    function test_Constructor_SetsUSDCImmutable() public view {
        assertEq(address(vesting.usdc()), USDC_ADDR);
    }

    function test_Constructor_NotPaused() public view {
        assertFalse(vesting.paused());
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 2 — createSchedule happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateSchedule_HappyPath() public {
        uint128 balBefore = uint128(usdc.balanceOf(address(vesting)));
        uint128 ownerBefore = uint128(usdc.balanceOf(owner));

        uint48 startTime = uint48(block.timestamp);

        vm.prank(owner);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);

        // USDC pulled from owner
        assertEq(usdc.balanceOf(owner),            ownerBefore - AMOUNT);
        // USDC held by contract
        assertEq(usdc.balanceOf(address(vesting)),  balBefore + AMOUNT);

        // Schedule state is correct
        USDCVesting.VestingSchedule memory s = vesting.getSchedule(0);
        assertEq(s.beneficiary,   alice);
        assertEq(s.totalAmount,   AMOUNT);
        assertEq(s.claimedAmount, 0);
        assertFalse(s.revoked);
        assertEq(s.startTime, startTime);
        assertEq(s.cliffTime, startTime + CLIFF_DUR);
        assertEq(s.endTime,   startTime + VESTING_DUR);
    }

    function test_CreateSchedule_EmitsScheduleCreated() public {
        uint48 startTime = uint48(block.timestamp);
        uint48 cliffTime = startTime + CLIFF_DUR;
        uint48 endTime   = startTime + VESTING_DUR;

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(vesting));
        emit USDCVesting.ScheduleCreated(0, alice, AMOUNT, startTime, cliffTime, endTime);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
    }

    function test_CreateSchedule_IncrementScheduleId() public {
        uint48 startTime = uint48(block.timestamp);

        vm.startPrank(owner);
        vesting.createSchedule(alice,   AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        vesting.createSchedule(bob,     AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        vesting.createSchedule(charlie, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        vm.stopPrank();

        assertEq(vesting.getSchedule(0).beneficiary, alice);
        assertEq(vesting.getSchedule(1).beneficiary, bob);
        assertEq(vesting.getSchedule(2).beneficiary, charlie);
    }

    function test_CreateSchedule_RecordsBeneficiaryMapping() public {
        uint48 startTime = uint48(block.timestamp);

        vm.startPrank(owner);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        vm.stopPrank();

        uint256[] memory ids = vesting.getScheduleIds(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }

    function test_CreateSchedule_ZeroCliff_NoCliffPeriod() public {
        uint48 startTime = uint48(block.timestamp);
        // zero cliff is valid
        vm.prank(owner);
        vesting.createSchedule(alice, AMOUNT, 0, VESTING_DUR, startTime);

        USDCVesting.VestingSchedule memory s = vesting.getSchedule(0);
        assertEq(s.cliffTime, startTime); // cliff == start → tokens vest from t=0
    }

    function test_CreateSchedule_StartTimeInPast_Boundary() public {
        // startTime exactly 60 seconds old → should still be accepted
        uint48 startTime = uint48(block.timestamp - 60);
        vm.prank(owner);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);

        USDCVesting.VestingSchedule memory s = vesting.getSchedule(0);
        assertEq(s.startTime, startTime);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 3 — createSchedule revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateSchedule_Revert_ZeroBeneficiary() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(USDCVesting.ZeroBeneficiary.selector);
        vesting.createSchedule(address(0), AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
    }

    function test_CreateSchedule_Revert_ZeroAmount() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(USDCVesting.ZeroAmount.selector);
        vesting.createSchedule(alice, 0, CLIFF_DUR, VESTING_DUR, startTime);
    }

    function test_CreateSchedule_Revert_ZeroDuration() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(USDCVesting.ZeroDuration.selector);
        vesting.createSchedule(alice, AMOUNT, 0, 0, startTime);
    }

    function test_CreateSchedule_Revert_CliffExceedsDuration() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(USDCVesting.CliffExceedsDuration.selector);
        vesting.createSchedule(alice, AMOUNT, VESTING_DUR + 1, VESTING_DUR, startTime);
    }

    function test_CreateSchedule_Revert_StartTimeInPast() public {
        // startTime 61 seconds in the past → should revert
        uint48 staleStart = uint48(block.timestamp - 61);
        vm.prank(owner);
        vm.expectRevert(USDCVesting.StartTimeInPast.selector);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, staleStart);
    }

    function test_CreateSchedule_Revert_NonOwner() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
    }

    function test_CreateSchedule_Revert_WhenPaused() public {
        vm.prank(owner);
        vesting.pause();

        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 4 — claim happy paths
    // ═════════════════════════════════════════════════════════════════════════

    /// @dev Creates a standard schedule starting now, returns its id (0).
    function _createStdSchedule() internal returns (uint256 scheduleId) {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
        scheduleId = 0;
    }

    function test_Claim_BeforeCliff_Reverts() public {
        _createStdSchedule();

        // Warp to just before cliff
        skip(CLIFF_DUR - 1);

        vm.prank(alice);
        vm.expectRevert(USDCVesting.NothingClaimable.selector);
        vesting.claim(0);
    }

    function test_Claim_AtCliff_HappyPath() public {
        _createStdSchedule();

        // Warp to exactly the cliff
        skip(CLIFF_DUR);

        uint128 expectedVested = uint128((uint256(AMOUNT) * CLIFF_DUR) / VESTING_DUR);

        uint128 aliceBefore = uint128(usdc.balanceOf(alice));
        vm.prank(alice);
        vesting.claim(0);

        assertEq(usdc.balanceOf(alice), aliceBefore + expectedVested);
        assertEq(vesting.getSchedule(0).claimedAmount, expectedVested);
    }

    function test_Claim_EmitsClaimed() public {
        _createStdSchedule();
        skip(CLIFF_DUR);

        uint128 expectedVested = uint128((uint256(AMOUNT) * CLIFF_DUR) / VESTING_DUR);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(vesting));
        emit USDCVesting.Claimed(0, alice, expectedVested);
        vesting.claim(0);
    }

    function test_Claim_MidVesting() public {
        _createStdSchedule();

        // Warp halfway through
        uint48 halfDur = VESTING_DUR / 2;
        skip(halfDur);

        uint128 expectedVested = uint128((uint256(AMOUNT) * halfDur) / VESTING_DUR);

        vm.prank(alice);
        vesting.claim(0);

        assertEq(vesting.getSchedule(0).claimedAmount, expectedVested);
    }

    function test_Claim_AtEnd_AllVested() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(alice);
        vesting.claim(0);

        assertEq(usdc.balanceOf(alice),              AMOUNT);
        assertEq(vesting.getSchedule(0).claimedAmount, AMOUNT);
    }

    function test_Claim_ClaimedAmountMonotonicallyIncreases() public {
        _createStdSchedule();

        // First claim at cliff
        skip(CLIFF_DUR);
        vm.prank(alice);
        vesting.claim(0);
        uint128 firstClaim = vesting.getSchedule(0).claimedAmount;

        // Second claim halfway through remaining period
        skip((VESTING_DUR - CLIFF_DUR) / 2);
        vm.prank(alice);
        vesting.claim(0);
        uint128 secondClaim = vesting.getSchedule(0).claimedAmount;

        // Third claim at end
        skip(VESTING_DUR);
        vm.prank(alice);
        vesting.claim(0);
        uint128 thirdClaim = vesting.getSchedule(0).claimedAmount;

        assertGt(secondClaim, firstClaim);
        assertGt(thirdClaim,  secondClaim);
        assertEq(thirdClaim,  AMOUNT);
    }

    function test_Claim_NothingClaimable_TwiceInARow() public {
        _createStdSchedule();
        skip(CLIFF_DUR);

        vm.prank(alice);
        vesting.claim(0);

        // Claim again immediately with no new time passing → NothingClaimable
        vm.prank(alice);
        vm.expectRevert(USDCVesting.NothingClaimable.selector);
        vesting.claim(0);
    }

    function test_Claim_Revert_NotBeneficiary() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(bob);
        vm.expectRevert(USDCVesting.NotBeneficiary.selector);
        vesting.claim(0);
    }

    function test_Claim_Revert_ScheduleNotFound() public {
        vm.prank(alice);
        vm.expectRevert(USDCVesting.ScheduleNotFound.selector);
        vesting.claim(999);
    }

    function test_Claim_Revert_WhenPaused() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(owner);
        vesting.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vesting.claim(0);
    }

    function test_Claim_Works_AfterUnpause() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(owner);
        vesting.pause();

        vm.prank(owner);
        vesting.unpause();

        vm.prank(alice);
        vesting.claim(0);

        assertEq(vesting.getSchedule(0).claimedAmount, AMOUNT);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 5 — revoke
    // ═════════════════════════════════════════════════════════════════════════

    function test_Revoke_HappyPath_UnvestedReturnsToOwner() public {
        _createStdSchedule();

        // Warp to halfway — half is vested, half is unvested
        skip(VESTING_DUR / 2);

        uint128 vestedNow   = uint128((uint256(AMOUNT) * (VESTING_DUR / 2)) / VESTING_DUR);
        uint128 unvestedNow = AMOUNT - vestedNow;

        uint128 ownerBefore = uint128(usdc.balanceOf(owner));

        vm.prank(owner);
        vesting.revoke(0);

        // Unvested returned to owner
        assertEq(usdc.balanceOf(owner), ownerBefore + unvestedNow);

        // Schedule marked revoked
        assertTrue(vesting.getSchedule(0).revoked);
    }

    function test_Revoke_EmitsScheduleRevoked() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        uint128 vestedNow   = uint128((uint256(AMOUNT) * (VESTING_DUR / 2)) / VESTING_DUR);
        uint128 unvestedNow = AMOUNT - vestedNow;

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(vesting));
        emit USDCVesting.ScheduleRevoked(0, alice, unvestedNow);
        vesting.revoke(0);
    }

    function test_Revoke_VestedStaysClaimable() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        uint128 vestedAtRevoke = uint128((uint256(AMOUNT) * (VESTING_DUR / 2)) / VESTING_DUR);

        vm.prank(owner);
        vesting.revoke(0);

        // Alice can still claim what was vested at revoke time
        vm.prank(alice);
        vesting.claim(0);

        assertEq(usdc.balanceOf(alice), vestedAtRevoke);
    }

    function test_Revoke_BeneficiaryCanClaimAfterRevoke() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        vm.prank(owner);
        vesting.revoke(0);

        // Advance time further — should make no difference (capped at revokeTime)
        skip(VESTING_DUR);

        uint128 vestedAtRevoke = uint128((uint256(AMOUNT) * (VESTING_DUR / 2)) / VESTING_DUR);

        vm.prank(alice);
        vesting.claim(0);

        assertEq(usdc.balanceOf(alice), vestedAtRevoke);
    }

    function test_Revoke_NothingVestedBeforeStart() public {
        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);

        // Revoke immediately (before start) — all unvested
        uint128 ownerBefore = uint128(usdc.balanceOf(owner));
        vm.prank(owner);
        vesting.revoke(0);

        assertEq(usdc.balanceOf(owner), ownerBefore + AMOUNT);
    }

    function test_Revoke_Revert_AlreadyRevoked() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        vm.prank(owner);
        vesting.revoke(0);

        vm.prank(owner);
        vm.expectRevert(USDCVesting.AlreadyRevoked.selector);
        vesting.revoke(0);
    }

    function test_Revoke_Revert_FullyClaimed() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(alice);
        vesting.claim(0);

        vm.prank(owner);
        vm.expectRevert(USDCVesting.FullyClaimed.selector);
        vesting.revoke(0);
    }

    function test_Revoke_Revert_ScheduleNotFound() public {
        vm.prank(owner);
        vm.expectRevert(USDCVesting.ScheduleNotFound.selector);
        vesting.revoke(999);
    }

    function test_Revoke_Revert_NonOwner() public {
        _createStdSchedule();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.revoke(0);
    }

    function test_Revoke_NotBlocked_WhenPaused() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        vm.prank(owner);
        vesting.pause();

        // revoke has no whenNotPaused modifier — should succeed
        vm.prank(owner);
        vesting.revoke(0);

        assertTrue(vesting.getSchedule(0).revoked);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 6 — rescueStuckVesting
    // ═════════════════════════════════════════════════════════════════════════

    function test_Rescue_HappyPath_PushesVestedToBeneficiary() public {
        _createStdSchedule();
        skip(VESTING_DUR); // fully vested

        uint128 aliceBefore   = uint128(usdc.balanceOf(alice));
        uint128 contractBefore = uint128(usdc.balanceOf(address(vesting)));

        vm.prank(owner);
        vesting.rescueStuckVesting(0);

        assertEq(usdc.balanceOf(alice),            aliceBefore   + AMOUNT);
        assertEq(usdc.balanceOf(address(vesting)), contractBefore - AMOUNT);
        assertEq(vesting.getSchedule(0).claimedAmount, AMOUNT);
    }

    function test_Rescue_EmitsStuckVestingRescued() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(vesting));
        emit USDCVesting.StuckVestingRescued(0, alice, AMOUNT);
        vesting.rescueStuckVesting(0);
    }

    function test_Rescue_Revert_NothingClaimable_BeforeCliff() public {
        _createStdSchedule();
        // No time warp → nothing vested

        vm.prank(owner);
        vm.expectRevert(USDCVesting.NothingClaimable.selector);
        vesting.rescueStuckVesting(0);
    }

    function test_Rescue_Revert_NothingClaimable_AlreadyClaimed() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        // Beneficiary already claimed everything
        vm.prank(alice);
        vesting.claim(0);

        vm.prank(owner);
        vm.expectRevert(USDCVesting.NothingClaimable.selector);
        vesting.rescueStuckVesting(0);
    }

    function test_Rescue_Revert_ScheduleNotFound() public {
        vm.prank(owner);
        vm.expectRevert(USDCVesting.ScheduleNotFound.selector);
        vesting.rescueStuckVesting(999);
    }

    function test_Rescue_Revert_NonOwner() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.rescueStuckVesting(0);
    }

    function test_Rescue_MidVesting_PartialAmount() public {
        _createStdSchedule();
        skip(CLIFF_DUR); // only cliffDur/vestingDur fraction vested

        uint128 expectedVested = uint128((uint256(AMOUNT) * CLIFF_DUR) / VESTING_DUR);

        vm.prank(owner);
        vesting.rescueStuckVesting(0);

        assertEq(usdc.balanceOf(alice), expectedVested);
        assertEq(vesting.getSchedule(0).claimedAmount, expectedVested);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 7 — pause / unpause
    // ═════════════════════════════════════════════════════════════════════════

    function test_Pause_BlocksClaim() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        vm.prank(owner);
        vesting.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vesting.claim(0);
    }

    function test_Pause_BlocksCreateSchedule() public {
        vm.prank(owner);
        vesting.pause();

        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vesting.createSchedule(alice, AMOUNT, CLIFF_DUR, VESTING_DUR, startTime);
    }

    function test_Pause_DoesNotBlockRevoke() public {
        _createStdSchedule();

        vm.prank(owner);
        vesting.pause();

        // revoke is NOT guarded by whenNotPaused
        vm.prank(owner);
        vesting.revoke(0); // must not revert

        assertTrue(vesting.getSchedule(0).revoked);
    }

    function test_Pause_EmitsPaused() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, false, address(vesting));
        emit Pausable.Paused(owner);
        vesting.pause();
    }

    function test_Unpause_EmitsUnpaused() public {
        vm.prank(owner);
        vesting.pause();

        vm.prank(owner);
        vm.expectEmit(false, false, false, false, address(vesting));
        emit Pausable.Unpaused(owner);
        vesting.unpause();
    }

    function test_Pause_Revert_NonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.pause();
    }

    function test_Unpause_Revert_NonOwner() public {
        vm.prank(owner);
        vesting.pause();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.unpause();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 8 — renounceOwnership always reverts
    // ═════════════════════════════════════════════════════════════════════════

    function test_RenounceOwnership_AlwaysReverts() public {
        vm.prank(owner);
        vm.expectRevert(USDCVesting.RenounceOwnershipDisabled.selector);
        vesting.renounceOwnership();
    }

    function test_RenounceOwnership_Revert_NonOwner() public {
        vm.prank(alice);
        // OwnableUnauthorizedAccount fires BEFORE RenounceOwnershipDisabled because
        // the `onlyOwner` modifier is checked first.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vesting.renounceOwnership();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 9 — vestedAmount view function edge cases
    // ═════════════════════════════════════════════════════════════════════════

    function test_VestedAmount_ZeroForNonexistentSchedule() public view {
        assertEq(vesting.vestedAmount(999, block.timestamp), 0);
    }

    function test_VestedAmount_ZeroBeforeCliff() public {
        _createStdSchedule();
        assertEq(vesting.vestedAmount(0, block.timestamp + CLIFF_DUR - 1), 0);
    }

    function test_VestedAmount_FullAmountAtEnd() public {
        _createStdSchedule();
        assertEq(vesting.vestedAmount(0, block.timestamp + VESTING_DUR), AMOUNT);
    }

    function test_VestedAmount_FullAmountBeyondEnd() public {
        _createStdSchedule();
        assertEq(vesting.vestedAmount(0, block.timestamp + VESTING_DUR + 365 days), AMOUNT);
    }

    function test_VestedAmount_CappedAtRevokeTime() public {
        _createStdSchedule();
        skip(VESTING_DUR / 2);

        uint48 revokeTs = uint48(block.timestamp);
        uint128 vestedAtRevoke = uint128((uint256(AMOUNT) * (VESTING_DUR / 2)) / VESTING_DUR);

        vm.prank(owner);
        vesting.revoke(0);

        // Even when queried at a much later timestamp it stays capped
        assertEq(vesting.vestedAmount(0, revokeTs + uint256(VESTING_DUR) * 2), vestedAtRevoke);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 10 — claimableAmount view helper
    // ═════════════════════════════════════════════════════════════════════════

    function test_ClaimableAmount_ZeroBeforeCliff() public {
        _createStdSchedule();
        assertEq(vesting.claimableAmount(0), 0);
    }

    function test_ClaimableAmount_DecreasesAfterClaim() public {
        _createStdSchedule();
        skip(VESTING_DUR);

        assertEq(vesting.claimableAmount(0), AMOUNT);

        vm.prank(alice);
        vesting.claim(0);

        assertEq(vesting.claimableAmount(0), 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SECTION 11 — Fuzz: vestedAmount always in [0, totalAmount]
    // ═════════════════════════════════════════════════════════════════════════

    function testFuzz_VestedAmount_AlwaysInBounds(
        uint128 totalAmount,
        uint48  vestingDuration,
        uint48  cliffDuration,
        uint256 queryTimestamp
    ) public {
        totalAmount     = uint128(bound(totalAmount,     1,           type(uint96).max));
        vestingDuration = uint48 (bound(vestingDuration, 1,           365 days * 10));
        cliffDuration   = uint48 (bound(cliffDuration,   0,           vestingDuration));
        queryTimestamp  =         bound(queryTimestamp,  0,           block.timestamp + uint256(vestingDuration) * 2);

        uint48 startTime = uint48(block.timestamp);

        // Mint enough and approve
        usdc.mint(owner, totalAmount);
        vm.prank(owner);
        usdc.approve(address(vesting), type(uint256).max);

        vm.prank(owner);
        vesting.createSchedule(alice, totalAmount, cliffDuration, vestingDuration, startTime);

        // The last created scheduleId is 0 for a fresh setUp, but this is a fuzz test
        // so we read it via getScheduleIds
        uint256[] memory ids = vesting.getScheduleIds(alice);
        uint256 scheduleId = ids[ids.length - 1];

        uint128 vested = vesting.vestedAmount(scheduleId, queryTimestamp);

        assertGe(vested, 0);
        assertLe(vested, totalAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: claim amount is always exactly vested - previously claimed
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_Claim_AmountEqualsVestedMinusClaimed(
        uint48 warpSeconds
    ) public {
        // Warp to somewhere within vesting (at or after cliff)
        warpSeconds = uint48(bound(warpSeconds, CLIFF_DUR, VESTING_DUR));

        _createStdSchedule();
        skip(warpSeconds);

        uint128 vestedBefore   = vesting.vestedAmount(0, block.timestamp);
        uint128 claimedBefore  = vesting.getSchedule(0).claimedAmount;
        uint128 expectedClaim  = vestedBefore - claimedBefore;

        uint128 aliceBefore = uint128(usdc.balanceOf(alice));
        vm.prank(alice);
        vesting.claim(0);

        assertEq(usdc.balanceOf(alice) - aliceBefore, expectedClaim);
        assertEq(vesting.getSchedule(0).claimedAmount, claimedBefore + expectedClaim);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: revoke returns exactly unvested tokens to owner
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_Revoke_UnvestedReturnedToOwner(uint48 warpSeconds) public {
        warpSeconds = uint48(bound(warpSeconds, 0, VESTING_DUR));
        _createStdSchedule();
        skip(warpSeconds);

        uint128 vestedNow   = vesting.vestedAmount(0, block.timestamp);
        uint128 unvestedNow = AMOUNT - vestedNow;

        uint128 ownerBefore = uint128(usdc.balanceOf(owner));

        vm.prank(owner);
        vesting.revoke(0);

        assertEq(usdc.balanceOf(owner), ownerBefore + unvestedNow);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: vestedAmount is monotonically non-decreasing in time (no revoke)
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_VestedAmount_Monotone(
        uint256 t1,
        uint256 t2
    ) public {
        _createStdSchedule();

        USDCVesting.VestingSchedule memory s = vesting.getSchedule(0);
        uint256 start = s.startTime;
        uint256 end   = s.endTime;

        t1 = bound(t1, start, end);
        t2 = bound(t2, t1,    end);

        assertLe(vesting.vestedAmount(0, t1), vesting.vestedAmount(0, t2));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: createSchedule always pulls exactly totalAmount from owner
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_CreateSchedule_PullsExactAmount(uint128 amount) public {
        amount = uint128(bound(amount, 1, 10_000_000e6));

        // Fresh setUp already minted 100M and approved max. Make sure there's enough.
        usdc.mint(owner, amount);

        uint128 ownerBefore    = uint128(usdc.balanceOf(owner));
        uint128 contractBefore = uint128(usdc.balanceOf(address(vesting)));

        uint48 startTime = uint48(block.timestamp);
        vm.prank(owner);
        vesting.createSchedule(alice, amount, 0, VESTING_DUR, startTime);

        assertEq(usdc.balanceOf(owner),            ownerBefore    - amount);
        assertEq(usdc.balanceOf(address(vesting)), contractBefore + amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract (separate from unit tests so targetContract applies)
// ─────────────────────────────────────────────────────────────────────────────
contract USDCVestingInvariantTest is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    address internal owner = makeAddr("invariant-owner");

    USDCVesting    internal vesting;
    MockERC20      internal usdc;
    VestingHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);

        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mock).code);
        usdc = MockERC20(USDC_ADDR);

        vm.prank(owner);
        vesting = new USDCVesting(owner);

        handler = new VestingHandler(vesting, usdc, owner);

        // Allow the handler to spend on behalf of owner
        vm.prank(owner);
        usdc.approve(address(vesting), type(uint256).max);

        targetContract(address(handler));
    }

    /// @notice The contract's USDC balance must always be >=
    ///         sum(totalAmount[i] - claimedAmount[i]) for all non-revoked, non-fully-claimed schedules.
    /// @dev    We use the ghost variables maintained by the handler as a proxy:
    ///         ghostDeposited - ghostWithdrawn = expected remaining balance.
    function invariant_ContractBalanceCoversPendingVesting() public view {
        uint256 remaining = handler.ghostDeposited() - handler.ghostWithdrawn();
        assertGe(usdc.balanceOf(address(vesting)), remaining);
    }

    /// @notice vestedAmount never exceeds totalAmount for any schedule.
    function invariant_VestedNeverExceedsTotalAmount() public view {
        uint256 count = handler.schedulesCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 scheduleId = handler.scheduleIds(i);
            USDCVesting.VestingSchedule memory s = vesting.getSchedule(scheduleId);
            uint128 vested = vesting.vestedAmount(scheduleId, block.timestamp);
            assertLe(vested, s.totalAmount);
        }
    }

    /// @notice claimedAmount never exceeds totalAmount for any schedule.
    function invariant_ClaimedNeverExceedsTotalAmount() public view {
        uint256 count = handler.schedulesCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 scheduleId = handler.scheduleIds(i);
            USDCVesting.VestingSchedule memory s = vesting.getSchedule(scheduleId);
            assertLe(s.claimedAmount, s.totalAmount);
        }
    }
}
