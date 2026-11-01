// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {MockERC20} from "../test-helpers/MockERC20.sol";
import {SelfServiceVesting} from "../SelfServiceVesting.sol";
import {USDCVesting} from "../USDCVesting.sol";

/// @dev Confirms that the explicit-token self-service implementation preserves
/// the deployed Core schedule semantics for the canonical Arc USDC address.
contract VestingDifferentialTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal owner = makeAddr("owner");
    address internal beneficiary = makeAddr("beneficiary");

    function test_LegacyAndSelfServiceScheduleMathMatches() public {
        vm.warp(1_000_000);

        MockERC20 implementation = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(ARC_USDC, address(implementation).code);
        MockERC20 token = MockERC20(ARC_USDC);
        token.mint(owner, 2_000e6);

        USDCVesting legacy = new USDCVesting(owner);
        SelfServiceVesting selfService = new SelfServiceVesting(ARC_USDC, owner);

        vm.startPrank(owner);
        token.approve(address(legacy), type(uint256).max);
        token.approve(address(selfService), type(uint256).max);
        legacy.createSchedule(beneficiary, 1_000e6, 100, 1_000, uint48(block.timestamp));
        selfService.createSchedule(beneficiary, 1_000e6, 100, 1_000, uint48(block.timestamp));
        vm.stopPrank();

        USDCVesting.VestingSchedule memory legacySchedule = legacy.getSchedule(0);
        SelfServiceVesting.VestingSchedule memory selfServiceSchedule = selfService.getSchedule(0);
        assertEq(legacySchedule.beneficiary, selfServiceSchedule.beneficiary);
        assertEq(legacySchedule.startTime, selfServiceSchedule.startTime);
        assertEq(legacySchedule.cliffTime, selfServiceSchedule.cliffTime);
        assertEq(legacySchedule.endTime, selfServiceSchedule.endTime);
        assertEq(legacySchedule.totalAmount, selfServiceSchedule.totalAmount);
        assertEq(legacySchedule.claimedAmount, selfServiceSchedule.claimedAmount);

        vm.warp(block.timestamp + 500);
        assertEq(legacy.vestedAmount(0, block.timestamp), selfService.vestedAmount(0, block.timestamp));
        assertEq(legacy.claimableAmount(0), selfService.claimableAmount(0));
    }
}
