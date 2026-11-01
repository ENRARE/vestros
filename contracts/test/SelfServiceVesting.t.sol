// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MockERC20} from "../test-helpers/MockERC20.sol";
import {FalseReturningERC20, RevertingERC20} from "../test-helpers/AdversarialERC20.sol";
import {SelfServiceVesting} from "../SelfServiceVesting.sol";

contract SelfServiceVestingTest is Test {
    MockERC20 internal usdc;
    SelfServiceVesting internal vault;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal charlie = makeAddr("charlie");

    uint128 internal constant AMOUNT = 1_000e6;
    uint48 internal constant VESTING_DURATION = 365 days;
    uint48 internal constant CLIFF_DURATION = 90 days;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new SelfServiceVesting(address(usdc), alice);
        usdc.mint(alice, 100_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_Constructor_AssignsOwnerAndToken() public view {
        assertEq(vault.owner(), alice);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(address(vault.usdc()), address(usdc));
    }

    function test_CreateSchedule_OnlyVaultOwnerCanFund() public {
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, CLIFF_DURATION, VESTING_DURATION, uint48(block.timestamp));

        SelfServiceVesting.VestingSchedule memory schedule = vault.getSchedule(0);
        assertEq(schedule.beneficiary, bob);
        assertEq(schedule.totalAmount, AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
    }

    function test_CreateSchedule_SupportsMultipleBeneficiaries() public {
        vm.startPrank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));
        vault.createSchedule(charlie, AMOUNT / 2, 0, VESTING_DURATION, uint48(block.timestamp));
        vm.stopPrank();

        assertEq(vault.getScheduleIds(bob).length, 1);
        assertEq(vault.getScheduleIds(charlie).length, 1);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT + AMOUNT / 2);
    }

    function test_CreateSchedule_RevertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vault.createSchedule(charlie, AMOUNT, CLIFF_DURATION, VESTING_DURATION, uint48(block.timestamp));
    }

    function test_CreateSchedule_RollsBackOnFundingFailure() public {
        SelfServiceVesting unfundedVault = new SelfServiceVesting(address(usdc), alice);

        vm.prank(alice);
        vm.expectRevert();
        unfundedVault.createSchedule(bob, AMOUNT, CLIFF_DURATION, VESTING_DURATION, uint48(block.timestamp));

        SelfServiceVesting.VestingSchedule memory schedule = unfundedVault.getSchedule(0);
        assertEq(schedule.totalAmount, 0);
        assertEq(unfundedVault.getScheduleIds(bob).length, 0);
        assertEq(usdc.balanceOf(address(unfundedVault)), 0);
    }

    function test_CreateSchedule_RollsBackWhenTokenReturnsFalse() public {
        FalseReturningERC20 token = new FalseReturningERC20();
        SelfServiceVesting falseTokenVault = new SelfServiceVesting(address(token), alice);

        vm.prank(alice);
        vm.expectRevert();
        falseTokenVault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        assertEq(falseTokenVault.getSchedule(0).totalAmount, 0);
        assertEq(falseTokenVault.getScheduleIds(bob).length, 0);
    }

    function test_CreateSchedule_RollsBackWhenTokenReverts() public {
        RevertingERC20 token = new RevertingERC20();
        SelfServiceVesting revertingTokenVault = new SelfServiceVesting(address(token), alice);

        vm.prank(alice);
        vm.expectRevert(RevertingERC20.TransferBlocked.selector);
        revertingTokenVault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        assertEq(revertingTokenVault.getSchedule(0).totalAmount, 0);
        assertEq(revertingTokenVault.getScheduleIds(bob).length, 0);
    }

    function test_CreateSchedule_RevertsBeforeStateWriteOnUint48EndTimeOverflow() public {
        uint48 start = type(uint48).max - 10;
        vm.warp(start);

        vm.prank(alice);
        vm.expectRevert();
        vault.createSchedule(bob, AMOUNT, 0, 11, start);

        assertEq(vault.getSchedule(0).totalAmount, 0);
        assertEq(vault.getScheduleIds(bob).length, 0);
    }

    function test_CreateSchedule_EnforcesTheSixtySecondStartHeadroom() public {
        uint48 start = uint48(block.timestamp - 61);

        vm.prank(alice);
        vm.expectRevert(SelfServiceVesting.StartTimeInPast.selector);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, start);

        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp - 60));
        assertEq(vault.getSchedule(0).totalAmount, AMOUNT);
    }

    function test_CrossUserCannotRescueAnotherBeneficiarySchedule() public {
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        skip(VESTING_DURATION);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vault.rescueStuckVesting(0);
    }

    function test_Claim_BeneficiaryOnlyAfterVesting() public {
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        vm.prank(charlie);
        vm.expectRevert(SelfServiceVesting.NotBeneficiary.selector);
        vault.claim(0);

        skip(VESTING_DURATION);
        vm.prank(bob);
        vault.claim(0);

        assertEq(usdc.balanceOf(bob), AMOUNT);
        assertEq(vault.getSchedule(0).claimedAmount, AMOUNT);
    }

    function test_Revoke_ReturnsUnvestedToOwner() public {
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        uint256 ownerBefore = usdc.balanceOf(alice);
        skip(VESTING_DURATION / 2);

        vm.prank(alice);
        vault.revoke(0);

        assertGt(usdc.balanceOf(alice), ownerBefore);
        assertTrue(vault.getSchedule(0).revoked);
    }

    function test_CrossUserCannotRevokeOrPause() public {
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vault.revoke(0);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vault.pause();
    }

    function test_Pause_BlocksWritesUntilOwnerUnpauses() public {
        vm.prank(alice);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));

        vm.prank(alice);
        vault.unpause();
        vm.prank(alice);
        vault.createSchedule(bob, AMOUNT, 0, VESTING_DURATION, uint48(block.timestamp));
        assertEq(vault.getSchedule(0).totalAmount, AMOUNT);
    }

    function testFuzz_VestedAmountAlwaysWithinScheduleBounds(
        uint128 amount,
        uint48 duration,
        uint48 cliff,
        uint256 queryTimestamp
    ) public {
        amount = uint128(bound(amount, 1, 10_000e6));
        duration = uint48(bound(duration, 1, 365 days * 10));
        cliff = uint48(bound(cliff, 0, duration));
        uint48 start = uint48(block.timestamp);
        queryTimestamp = bound(queryTimestamp, start, uint256(start) + duration * 2);

        usdc.mint(alice, amount);
        vm.prank(alice);
        vault.createSchedule(bob, amount, cliff, duration, start);

        uint128 vested = vault.vestedAmount(0, queryTimestamp);
        assertLe(vested, amount);
    }

    function test_OwnershipTransferRequiresPendingOwnerAcceptance() public {
        vm.prank(alice);
        vault.transferOwnership(charlie);

        assertEq(vault.owner(), alice);
        assertEq(vault.pendingOwner(), charlie);

        vm.prank(charlie);
        vault.acceptOwnership();

        assertEq(vault.owner(), charlie);
        assertEq(vault.pendingOwner(), address(0));
    }
}

contract SelfServiceVestingInvariantTest is Test {
    MockERC20 internal usdc;
    SelfServiceVesting internal vault;
    SelfServiceVestingHandler internal handler;

    address internal owner = makeAddr("invariant-owner");

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new SelfServiceVesting(address(usdc), owner);
        handler = new SelfServiceVestingHandler(vault, usdc, owner);
        targetContract(address(handler));
    }

    function invariant_VaultBalanceMatchesHandlerAccounting() public view {
        assertEq(usdc.balanceOf(address(vault)), handler.expectedBalance());
    }
}

contract SelfServiceVestingHandler is Test {
    SelfServiceVesting internal vault;
    MockERC20 internal usdc;
    address internal owner;
    uint256 internal deposited;

    constructor(SelfServiceVesting vault_, MockERC20 usdc_, address owner_) {
        vault = vault_;
        usdc = usdc_;
        owner = owner_;
    }

    function create(uint128 amount, uint48 duration, uint48 cliff) external {
        amount = uint128(bound(amount, 1, 10_000e6));
        duration = uint48(bound(duration, 1, 365 days));
        cliff = uint48(bound(cliff, 0, duration));

        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(vault), amount);
        vault.createSchedule(address(uint160(uint256(keccak256(abi.encode("beneficiary", deposited))))), amount, cliff, duration, uint48(block.timestamp));
        vm.stopPrank();
        deposited += amount;
    }

    function expectedBalance() external view returns (uint256) {
        return deposited;
    }
}
