// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GrantPoolTestBase} from "./GrantPool.Base.t.sol";
import {GrantPool} from "../GrantPool.sol";

/// @dev Fuzz tests for createAward amount boundary vs confirmedBalance.
contract GrantPoolFuzzTest is GrantPoolTestBase {

    // ── Fuzz: createAward amount exactly at and just above confirmedBalance ────

    /// Any deposit amount in [1, 10_000e6] and any award amount in [1, deposit]
    /// must succeed and shift balances correctly.
    function testFuzz_CreateAward_WithinBalance(
        uint256 depositAmt,
        uint256 awardAmt
    ) public {
        depositAmt = bound(depositAmt, 1, 100_000e6);
        awardAmt   = bound(awardAmt,   1, depositAmt);

        // Ensure alice has enough tokens
        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);

        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        pool.createAward(alice, awardAmt, DEFAULT_CLIFF, DEFAULT_VESTING);

        assertEq(pool.committedBalance(), awardAmt);
        assertEq(pool.confirmedBalance(), depositAmt - awardAmt);
    }

    /// Award amount exactly equal to confirmedBalance must succeed.
    function testFuzz_CreateAward_ExactlyAtConfirmedBalance(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000e6);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);
        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        uint256 id = pool.createAward(alice, depositAmt, DEFAULT_CLIFF, DEFAULT_VESTING);

        assertEq(id, 0);
        assertEq(pool.committedBalance(), depositAmt);
        assertEq(pool.confirmedBalance(), 0);
    }

    /// Award amount one unit above confirmedBalance must always revert.
    function testFuzz_CreateAward_OverBalance_Reverts(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1, type(uint128).max);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);
        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        vm.expectRevert(GrantPool.InsufficientConfirmedBalance.selector);
        pool.createAward(alice, depositAmt + 1, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    /// Zero award amount must always revert regardless of pool balance.
    function testFuzz_CreateAward_ZeroAmount_Reverts(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000e6);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);
        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        vm.expectRevert(GrantPool.ZeroAmount.selector);
        pool.createAward(alice, 0, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    /// Fuzz vestingDays=0 always reverts.
    function testFuzz_CreateAward_ZeroVestingDays_Reverts(
        uint256 depositAmt,
        uint256 awardAmt
    ) public {
        depositAmt = bound(depositAmt, 1, 100_000e6);
        awardAmt   = bound(awardAmt,   1, depositAmt);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);
        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        vm.expectRevert(GrantPool.VestingDaysZero.selector);
        pool.createAward(alice, awardAmt, 0, 0);
    }

    /// Fuzz cliff > vesting always reverts.
    function testFuzz_CreateAward_CliffExceedsVesting_Reverts(
        uint32 cliffDays,
        uint32 vestingDays
    ) public {
        // vestingDays must be > 0 so we don't hit VestingDaysZero first
        vestingDays = uint32(bound(vestingDays, 1, type(uint32).max - 1));
        cliffDays   = uint32(bound(cliffDays,   vestingDays + 1, type(uint32).max));

        _aliceDeposit(INITIAL_DEPOSIT);

        vm.prank(owner);
        vm.expectRevert(GrantPool.CliffExceedsVesting.selector);
        pool.createAward(alice, AWARD_AMOUNT, cliffDays, vestingDays);
    }

    /// Fuzz deposit then withdraw: confirmed balance tracks correctly.
    function testFuzz_Withdraw_UpdatesBalance(uint256 depositAmt, uint256 withdrawAmt) public {
        depositAmt  = bound(depositAmt,  1, 100_000e6);
        withdrawAmt = bound(withdrawAmt, 1, depositAmt);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(pool), depositAmt);
        vm.prank(alice);
        pool.deposit(depositAmt);

        vm.prank(owner);
        pool.withdraw(withdrawAmt);

        assertEq(pool.confirmedBalance(), depositAmt - withdrawAmt);
        assertEq(usdc.balanceOf(treasury), withdrawAmt);
    }
}
