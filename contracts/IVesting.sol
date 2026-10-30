// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVesting {
    function createSchedule(
        address beneficiary,
        uint128 totalAmount,
        uint48 cliffDuration,
        uint48 vestingDuration,
        uint48 startTime
    ) external;
}
