// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GrantPoolTestBase} from "./GrantPool.Base.t.sol";
import {GrantPool} from "../GrantPool.sol";
import {GrantVesting} from "../GrantVesting.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev Happy-path and revert tests for deposit, createAward, activateAward,
///      cancelAward, withdraw, setTreasury, and pause/unpause.
contract GrantPoolAwardsTest is GrantPoolTestBase {

    // ════════════════════════════════════════════════════════════════════════════
    // deposit
    // ════════════════════════════════════════════════════════════════════════════

    function test_Deposit_HappyPath_UpdatesConfirmedBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT);
    }

    function test_Deposit_HappyPath_TokenBalanceTransferred() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        assertEq(usdc.balanceOf(address(pool)), INITIAL_DEPOSIT);
    }

    function test_Deposit_HappyPath_EmitsDeposited() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(pool));
        emit GrantPool.Deposited(alice, INITIAL_DEPOSIT);
        pool.deposit(INITIAL_DEPOSIT);
    }

    function test_Deposit_HappyPath_MultipleDepositors() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(bob);
        pool.deposit(500e6);
        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT + 500e6);
    }

    function test_Deposit_Revert_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(GrantPool.ZeroAmount.selector);
        pool.deposit(0);
    }

    function test_Deposit_Blocked_WhenPaused() public {
        vm.prank(owner);
        pool.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.deposit(INITIAL_DEPOSIT);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // createAward
    // ════════════════════════════════════════════════════════════════════════════

    function test_CreateAward_HappyPath_ShiftsBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        uint256 id = _createAward(alice, AWARD_AMOUNT);

        assertEq(id, 0);
        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT - AWARD_AMOUNT);
        assertEq(pool.committedBalance(), AWARD_AMOUNT);
    }

    function test_CreateAward_HappyPath_EmitsAwardCreated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(pool));
        emit GrantPool.AwardCreated(0, alice, AWARD_AMOUNT);
        pool.createAward(alice, AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_CreateAward_HappyPath_AwardsCountIncremented() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        assertEq(pool.awardsCount(), 1);
    }

    function test_CreateAward_HappyPath_StoredCorrectly() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        (
            address beneficiary,
            uint256 amount,
            uint32  cliffDays,
            uint32  vestingDays,
            ,
            bool    activated,
            bool    cancelled
        ) = pool.awards(0);

        assertEq(beneficiary, alice);
        assertEq(amount,      AWARD_AMOUNT);
        assertEq(cliffDays,   DEFAULT_CLIFF);
        assertEq(vestingDays, DEFAULT_VESTING);
        assertFalse(activated);
        assertFalse(cancelled);
    }

    function test_CreateAward_ReturnsIncrementingIds() public {
        _aliceDeposit(INITIAL_DEPOSIT * 2);
        uint256 id0 = _createAward(alice, AWARD_AMOUNT);
        uint256 id1 = _createAward(alice, AWARD_AMOUNT);
        assertEq(id0, 0);
        assertEq(id1, 1);
    }

    function test_CreateAward_Revert_ZeroAddress() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectRevert(GrantPool.ZeroAddress.selector);
        pool.createAward(address(0), AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_CreateAward_Revert_ZeroAmount() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectRevert(GrantPool.ZeroAmount.selector);
        pool.createAward(alice, 0, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_CreateAward_Revert_VestingDaysZero() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectRevert(GrantPool.VestingDaysZero.selector);
        pool.createAward(alice, AWARD_AMOUNT, 0, 0);
    }

    function test_CreateAward_Revert_CliffExceedsVesting() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectRevert(GrantPool.CliffExceedsVesting.selector);
        pool.createAward(alice, AWARD_AMOUNT, 100, 50);
    }

    function test_CreateAward_Revert_InsufficientBalance() public {
        // No deposit — confirmedBalance == 0
        vm.prank(owner);
        vm.expectRevert(GrantPool.InsufficientConfirmedBalance.selector);
        pool.createAward(alice, AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_CreateAward_Revert_InsufficientBalance_AfterPartialDeposit() public {
        _aliceDeposit(500e6);
        vm.prank(owner);
        vm.expectRevert(GrantPool.InsufficientConfirmedBalance.selector);
        pool.createAward(alice, 1_000e6, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // activateAward
    // ════════════════════════════════════════════════════════════════════════════

    function test_ActivateAward_HappyPath_TransfersUsdcToBeneficiary() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        // USDC now goes to GrantVesting, NOT alice directly.
        assertEq(usdc.balanceOf(address(grantVesting)), AWARD_AMOUNT);
        // Alice's balance only decreased by the deposit; she gets nothing back yet.
        assertEq(usdc.balanceOf(alice), aliceBefore - INITIAL_DEPOSIT);
        // Accounting: award exits both committed and confirmed bookkeeping.
        assertEq(pool.committedBalance(), 0);
        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT - AWARD_AMOUNT);
    }

    function test_ActivateAward_HappyPath_DecreasesCommittedBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        uint256 committedBefore = pool.committedBalance();
        vm.prank(owner);
        pool.activateAward(0);

        assertEq(pool.committedBalance(), committedBefore - AWARD_AMOUNT);
    }

    function test_ActivateAward_HappyPath_EmitsAwardActivated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        // vestingContract is now a real address (not address(0));
        // vestingScheduleId is 0 (first schedule created in the vesting contract).
        // Check topic1 (awardId), topic2 (beneficiary), and all non-indexed data.
        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(pool));
        emit GrantPool.AwardActivated(
            0,
            alice,
            AWARD_AMOUNT,
            DEFAULT_CLIFF,
            DEFAULT_VESTING,
            0,
            address(grantVesting)
        );
        pool.activateAward(0);
    }

    function test_ActivateAward_HappyPath_MarksActivated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        (, , , , , bool activated, ) = pool.awards(0);
        assertTrue(activated);
    }

    function test_ActivateAward_Revert_InvalidAwardId() public {
        // No awards created — awardId 0 is out of range
        vm.prank(owner);
        vm.expectRevert(GrantPool.InvalidAward.selector);
        pool.activateAward(0);
    }

    function test_ActivateAward_Revert_AlreadyActivated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        vm.prank(owner);
        vm.expectRevert(GrantPool.AwardAlreadyActivated.selector);
        pool.activateAward(0);
    }

    function test_ActivateAward_Revert_AlreadyCancelled() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.cancelAward(0);

        vm.prank(owner);
        vm.expectRevert(GrantPool.AwardAlreadyCancelled.selector);
        pool.activateAward(0);
    }

    function test_ActivateAward_Revert_GrantVestingNotSet() public {
        // Deploy a fresh pool with NO grantVesting wired up.
        GrantPool pool2 = new GrantPool(address(usdc), treasury, owner);

        // Fund alice and approve pool2.
        vm.prank(alice);
        usdc.approve(address(pool2), type(uint256).max);

        // Deposit and create an award on pool2.
        vm.prank(alice);
        pool2.deposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        pool2.createAward(alice, AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);

        // activateAward must revert because grantVesting == address(0).
        vm.prank(owner);
        vm.expectRevert(GrantPool.GrantVestingNotSet.selector);
        pool2.activateAward(0);
    }

    function test_ActivateAward_Revert_DurationOverflow() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        pool.createAward(alice, AWARD_AMOUNT, 1, type(uint32).max);

        vm.prank(owner);
        vm.expectRevert(GrantPool.DurationOverflow.selector);
        pool.activateAward(0);

        (, , , , , bool activated, bool cancelled) = pool.awards(0);
        assertFalse(activated);
        assertFalse(cancelled);
        assertEq(pool.committedBalance(), AWARD_AMOUNT);
        assertEq(usdc.balanceOf(address(pool)), pool.confirmedBalance() + pool.committedBalance());
    }

    function test_ActivateAward_HappyPath_VestingScheduleCreated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        // The vesting contract should now hold exactly one schedule (id 0).
        GrantVesting.Schedule memory sched = grantVesting.getSchedule(0);
        assertEq(sched.beneficiary,  alice);
        assertEq(sched.totalAmount,  AWARD_AMOUNT);
    }

    // ════════════════════════════════════════════════════════════════════════════
    function test_RevokeVestingSchedule_RestoresUnvestedToConfirmedBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        vm.warp(block.timestamp + 100 days);
        uint256 vestedAtRevoke = grantVesting.vestedAmount(0);
        uint256 expectedReturned = AWARD_AMOUNT - vestedAtRevoke;

        vm.prank(owner);
        pool.revokeVestingSchedule(0);

        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT - AWARD_AMOUNT + expectedReturned);
        assertEq(usdc.balanceOf(address(pool)), pool.confirmedBalance() + pool.committedBalance());
    }

    // cancelAward
    // ════════════════════════════════════════════════════════════════════════════

    function test_CancelAward_HappyPath_RestoresConfirmedBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        uint256 confirmedBefore = pool.confirmedBalance();
        vm.prank(owner);
        pool.cancelAward(0);

        assertEq(pool.confirmedBalance(), confirmedBefore + AWARD_AMOUNT);
        assertEq(pool.committedBalance(), 0);
    }

    function test_CancelAward_HappyPath_EmitsAwardCancelled() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        vm.prank(owner);
        vm.expectEmit(true, false, false, false, address(pool));
        emit GrantPool.AwardCancelled(0);
        pool.cancelAward(0);
    }

    function test_CancelAward_HappyPath_MarksCancelled() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.cancelAward(0);

        (, , , , , , bool cancelled) = pool.awards(0);
        assertTrue(cancelled);
    }

    function test_CancelAward_Revert_AlreadyActivated() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.activateAward(0);

        vm.prank(owner);
        vm.expectRevert(GrantPool.AwardNotCancellable.selector);
        pool.cancelAward(0);
    }

    function test_CancelAward_Revert_AlreadyCancelled() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);
        vm.prank(owner);
        pool.cancelAward(0);

        vm.prank(owner);
        vm.expectRevert(GrantPool.AwardAlreadyCancelled.selector);
        pool.cancelAward(0);
    }

    function test_CancelAward_Revert_InvalidAwardId() public {
        vm.prank(owner);
        vm.expectRevert(GrantPool.InvalidAward.selector);
        pool.cancelAward(99);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // withdraw
    // ════════════════════════════════════════════════════════════════════════════

    function test_Withdraw_HappyPath_TransfersToTreasury() public {
        _aliceDeposit(INITIAL_DEPOSIT);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(owner);
        pool.withdraw(500e6);

        assertEq(usdc.balanceOf(treasury), treasuryBefore + 500e6);
    }

    function test_Withdraw_HappyPath_DecreasesConfirmedBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);

        vm.prank(owner);
        pool.withdraw(500e6);

        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT - 500e6);
    }

    function test_Withdraw_HappyPath_EmitsWithdrawn() public {
        _aliceDeposit(INITIAL_DEPOSIT);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(pool));
        emit GrantPool.Withdrawn(treasury, 500e6);
        pool.withdraw(500e6);
    }

    function test_Withdraw_HappyPath_FullBalance() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        pool.withdraw(INITIAL_DEPOSIT);
        assertEq(pool.confirmedBalance(), 0);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_Withdraw_Revert_ZeroAmount() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        vm.expectRevert(GrantPool.ZeroAmount.selector);
        pool.withdraw(0);
    }

    function test_Withdraw_Revert_InsufficientBalance() public {
        _aliceDeposit(100e6);
        vm.prank(owner);
        vm.expectRevert(GrantPool.InsufficientConfirmedBalance.selector);
        pool.withdraw(101e6);
    }

    function test_Withdraw_Revert_WhenPoolEmpty() public {
        vm.prank(owner);
        vm.expectRevert(GrantPool.InsufficientConfirmedBalance.selector);
        pool.withdraw(1e6);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // setTreasury
    // ════════════════════════════════════════════════════════════════════════════

    function test_SetTreasury_HappyPath_UpdatesAddress() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        pool.setTreasury(newTreasury);
        assertEq(pool.treasury(), newTreasury);
    }

    function test_SetTreasury_HappyPath_EmitsTreasuryUpdated() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(pool));
        emit GrantPool.TreasuryUpdated(treasury, newTreasury);
        pool.setTreasury(newTreasury);
    }

    function test_SetTreasury_Revert_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(GrantPool.ZeroAddress.selector);
        pool.setTreasury(address(0));
    }

    // ════════════════════════════════════════════════════════════════════════════
    // pause / unpause
    // ════════════════════════════════════════════════════════════════════════════

    function test_Pause_HappyPath_BlocksDeposit() public {
        vm.prank(owner);
        pool.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.deposit(INITIAL_DEPOSIT);
    }

    function test_Pause_HappyPath_BlocksCreateAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.createAward(alice, AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_Pause_HappyPath_BlocksActivateAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.activateAward(0);
    }

    function test_Pause_HappyPath_BlocksCancelAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.cancelAward(0);
    }

    function test_Pause_HappyPath_BlocksWithdraw() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.withdraw(100e6);
    }

    function test_Unpause_HappyPath_RestoresDeposit() public {
        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        pool.unpause();

        _aliceDeposit(INITIAL_DEPOSIT);
        assertEq(pool.confirmedBalance(), INITIAL_DEPOSIT);
    }
}
