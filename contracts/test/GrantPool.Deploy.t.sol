// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GrantPoolTestBase} from "./GrantPool.Base.t.sol";
import {GrantPool} from "../GrantPool.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Deployment / construction tests + onlyOwner guards on all write functions.
contract GrantPoolDeployTest is GrantPoolTestBase {

    // ── Constructor happy path ────────────────────────────────────────────────

    function test_Constructor_SetsUsdc() public view {
        assertEq(pool.usdc(), address(usdc));
    }

    function test_Constructor_SetsTreasury() public view {
        assertEq(pool.treasury(), treasury);
    }

    function test_Constructor_SetsOwner() public view {
        assertEq(pool.owner(), owner);
    }

    function test_Constructor_InitialBalancesZero() public view {
        assertEq(pool.confirmedBalance(), 0);
        assertEq(pool.committedBalance(), 0);
    }

    function test_Constructor_AwardsCountZero() public view {
        assertEq(pool.awardsCount(), 0);
    }

    // ── Constructor zero-address reverts ──────────────────────────────────────

    function test_Constructor_RevertIf_UsdcZero() public {
        vm.expectRevert(GrantPool.ZeroAddress.selector);
        new GrantPool(address(0), treasury, owner);
    }

    function test_Constructor_RevertIf_TreasuryZero() public {
        vm.expectRevert(GrantPool.ZeroAddress.selector);
        new GrantPool(address(usdc), address(0), owner);
    }

    /// OZ Ownable(address(0)) fires OwnableInvalidOwner before the pool's own
    /// ZeroAddress check, so we expect the OZ error here.
    function test_Constructor_RevertIf_OwnerZero() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new GrantPool(address(usdc), treasury, address(0));
    }

    // ── onlyOwner guards ──────────────────────────────────────────────────────
    // Each write function must revert for a non-owner caller.

    function test_OnlyOwner_CreateAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        vm.prank(stranger);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        pool.createAward(alice, AWARD_AMOUNT, DEFAULT_CLIFF, DEFAULT_VESTING);
    }

    function test_OnlyOwner_ActivateAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        vm.prank(stranger);
        vm.expectRevert();
        pool.activateAward(0);
    }

    function test_OnlyOwner_CancelAward() public {
        _aliceDeposit(INITIAL_DEPOSIT);
        _createAward(alice, AWARD_AMOUNT);

        vm.prank(stranger);
        vm.expectRevert();
        pool.cancelAward(0);
    }

    function test_OnlyOwner_Withdraw() public {
        _aliceDeposit(INITIAL_DEPOSIT);

        vm.prank(stranger);
        vm.expectRevert();
        pool.withdraw(1e6);
    }

    function test_OnlyOwner_SetTreasury() public {
        vm.prank(stranger);
        vm.expectRevert();
        pool.setTreasury(makeAddr("newTreasury"));
    }

    function test_OnlyOwner_Pause() public {
        vm.prank(stranger);
        vm.expectRevert();
        pool.pause();
    }

    function test_OnlyOwner_Unpause() public {
        vm.prank(owner);
        pool.pause();

        vm.prank(stranger);
        vm.expectRevert();
        pool.unpause();
    }
}
