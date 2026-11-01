// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVesting {
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 cliffDuration,
        uint48 vestingDuration
    ) external returns (uint256 scheduleId);
}
