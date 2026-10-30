// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GrantPool} from "../GrantPool.sol";
import {GrantVesting} from "../GrantVesting.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base: actors, mock USDC, a freshly deployed GrantPool, and a
///      wired-up GrantVesting contract (owned by the pool).
///      No test/fuzz/invariant functions — all category files inherit this.
abstract contract GrantPoolTestBase is Test {
    // ── Actors ────────────────────────────────────────────────────────────────
    address internal owner    = makeAddr("owner");
    address internal alice    = makeAddr("alice");    // depositor / beneficiary
    address internal bob      = makeAddr("bob");      // another depositor
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger"); // no special role

    // ── Token ─────────────────────────────────────────────────────────────────
    MockERC20 internal usdc;

    // ── Pool + Vesting ────────────────────────────────────────────────────────
    GrantPool    internal pool;
    GrantVesting internal grantVesting;

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 internal constant INITIAL_DEPOSIT  = 10_000e6;  // 10 000 USDC
    uint32  internal constant DEFAULT_CLIFF    = 30;
    uint32  internal constant DEFAULT_VESTING  = 365;
    uint256 internal constant AWARD_AMOUNT     = 1_000e6;   // 1 000 USDC

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // Deploy mock USDC
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy pool (owner-owned, treasury set)
        vm.prank(owner);
        pool = new GrantPool(address(usdc), treasury, owner);

        // Deploy GrantVesting with pool as its owner (required for createSchedule)
        grantVesting = new GrantVesting(address(usdc), address(pool));

        // Wire the vesting contract into the pool
        vm.prank(owner);
        pool.setGrantVesting(address(grantVesting));

        // Fund alice and approve pool
        usdc.mint(alice, INITIAL_DEPOSIT * 2);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);

        // Fund bob and approve pool
        usdc.mint(bob, INITIAL_DEPOSIT);
        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Deposit INITIAL_DEPOSIT from alice, returning the resulting confirmedBalance.
    function _aliceDeposit(uint256 amount) internal {
        vm.prank(alice);
        pool.deposit(amount);
    }

    /// Owner creates an award with default cliff/vesting parameters.
    function _createAward(address beneficiary, uint256 amount)
        internal
        returns (uint256 awardId)
    {
        vm.prank(owner);
        awardId = pool.createAward(beneficiary, amount, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    /// Fully sets up: deposit + create award + activate award.
    function _depositAndActivate(uint256 depositAmt, uint256 awardAmt)
        internal
        returns (uint256 awardId)
    {
        _aliceDeposit(depositAmt);
        awardId = _createAward(alice, awardAmt);
        vm.prank(owner);
        pool.activateAward(awardId);
    }
}
