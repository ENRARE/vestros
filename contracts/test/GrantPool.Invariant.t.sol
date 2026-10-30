// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GrantPool} from "../GrantPool.sol";
import {GrantVesting} from "../GrantVesting.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Handler contract that drives GrantPool state through all mutating
///      paths so the invariant runner can exercise the accounting invariant.
contract GrantPoolHandler is Test {
    GrantPool    public pool;
    GrantVesting public grantVesting;
    MockERC20    public usdc;
    address      public owner;
    address      public depositor;
    address      public beneficiary;

    uint256[] public liveAwardIds;   // awards created but not yet settled

    constructor(GrantPool pool_, MockERC20 usdc_, address owner_, address depositor_, address beneficiary_) {
        pool        = pool_;
        usdc        = usdc_;
        owner       = owner_;
        depositor   = depositor_;
        beneficiary = beneficiary_;

        // Deploy a GrantVesting owned by the pool and wire it in.
        grantVesting = new GrantVesting(address(usdc_), address(pool_));
        vm.prank(owner_);
        pool_.setGrantVesting(address(grantVesting));
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 100_000e6);
        usdc.mint(depositor, amount);
        vm.prank(depositor);
        usdc.approve(address(pool), amount);
        vm.prank(depositor);
        pool.deposit(amount);
    }

    function createAward(uint256 amount, uint32 cliff, uint32 vesting) external {
        uint256 confirmed = pool.confirmedBalance();
        if (confirmed == 0) return;
        amount  = bound(amount,  1, confirmed);
        vesting = uint32(bound(vesting, 1, 3650));
        cliff   = uint32(bound(cliff,   0, vesting));

        vm.prank(owner);
        uint256 id = pool.createAward(beneficiary, amount, cliff, vesting);
        liveAwardIds.push(id);
    }

    function activateAward(uint256 seed) external {
        if (liveAwardIds.length == 0) return;
        uint256 idx = seed % liveAwardIds.length;
        uint256 id  = liveAwardIds[idx];

        // Skip if already settled (cancelled or activated)
        (, , , , , bool activated, bool cancelled) = pool.awards(id);
        if (activated || cancelled) {
            _removeAt(idx);
            return;
        }

        vm.prank(owner);
        pool.activateAward(id);
        _removeAt(idx);
    }

    function cancelAward(uint256 seed) external {
        if (liveAwardIds.length == 0) return;
        uint256 idx = seed % liveAwardIds.length;
        uint256 id  = liveAwardIds[idx];

        (, , , , , bool activated, bool cancelled) = pool.awards(id);
        if (activated || cancelled) {
            _removeAt(idx);
            return;
        }

        vm.prank(owner);
        pool.cancelAward(id);
        _removeAt(idx);
    }

    function withdraw(uint256 amount) external {
        uint256 confirmed = pool.confirmedBalance();
        if (confirmed == 0) return;
        amount = bound(amount, 1, confirmed);
        vm.prank(owner);
        pool.withdraw(amount);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _removeAt(uint256 idx) internal {
        liveAwardIds[idx] = liveAwardIds[liveAwardIds.length - 1];
        liveAwardIds.pop();
    }
}

/// @dev Invariant: committedBalance + confirmedBalance == actual USDC balance of pool.
contract GrantPoolInvariantTest is Test {
    GrantPool        internal pool;
    MockERC20        internal usdc;
    GrantPoolHandler internal handler;

    address internal owner       = makeAddr("invOwner");
    address internal depositor   = makeAddr("invDepositor");
    address internal beneficiary = makeAddr("invBeneficiary");
    address internal treasury    = makeAddr("invTreasury");

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        vm.prank(owner);
        pool = new GrantPool(address(usdc), treasury, owner);

        handler = new GrantPoolHandler(pool, usdc, owner, depositor, beneficiary);

        targetContract(address(handler));
    }

    /// @dev Core invariant: the pool's token balance must always equal the sum
    ///      of confirmedBalance and committedBalance.
    function invariant_BalanceEquality() public view {
        uint256 tokenBalance = usdc.balanceOf(address(pool));
        assertEq(
            pool.confirmedBalance() + pool.committedBalance(),
            tokenBalance,
            "Invariant violated: confirmedBalance + committedBalance != token balance"
        );
    }

    /// @dev committedBalance must never exceed the pool's actual token balance
    ///      (confirmedBalance can never go negative).
    function invariant_CommittedNeverExceedsToken() public view {
        assertLe(
            pool.committedBalance(),
            usdc.balanceOf(address(pool)),
            "Invariant violated: committedBalance > token balance"
        );
    }

    /// @dev confirmedBalance must never exceed the pool's actual token balance.
    function invariant_ConfirmedNeverExceedsToken() public view {
        assertLe(
            pool.confirmedBalance(),
            usdc.balanceOf(address(pool)),
            "Invariant violated: confirmedBalance > token balance"
        );
    }
}
