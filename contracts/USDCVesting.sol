// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract USDCVesting is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroBeneficiary();
    error ZeroAmount();
    error ZeroDuration();
    error CliffExceedsDuration();
    error ScheduleNotFound();
    error NotBeneficiary();
    error AlreadyRevoked();
    error FullyClaimed();
    error NothingClaimable();
    error StartTimeInPast();
    error RenounceOwnershipDisabled();

    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint128 totalAmount,
        uint48 startTime,
        uint48 cliffTime,
        uint48 endTime
    );

    event Claimed(uint256 indexed scheduleId, address indexed beneficiary, uint128 amount);

    event ScheduleRevoked(uint256 indexed scheduleId, address indexed beneficiary, uint128 unvestedReturned);

    event StuckVestingRescued(uint256 indexed scheduleId, address indexed beneficiary, uint128 amount);

    struct VestingSchedule {
        address beneficiary;
        bool revoked;
        uint48 startTime;
        uint48 cliffTime;
        uint48 endTime;
        uint48 revokeTime;
        uint128 totalAmount;
        uint128 claimedAmount;
    }

    IERC20 public immutable usdc;

    mapping(uint256 => VestingSchedule) private _schedules;
    mapping(address => uint256[]) private _beneficiarySchedules;
    uint256 private _nextScheduleId;

    constructor(address _initialOwner) Ownable(_initialOwner) {
        usdc = IERC20(0x3600000000000000000000000000000000000000);
    }

    function createSchedule(
        address beneficiary,
        uint128 totalAmount,
        uint48 cliffDuration,
        uint48 vestingDuration,
        uint48 startTime
    ) external onlyOwner whenNotPaused nonReentrant {
        if (beneficiary == address(0)) revert ZeroBeneficiary();
        if (totalAmount == 0) revert ZeroAmount();
        if (vestingDuration == 0) revert ZeroDuration();
        if (cliffDuration > vestingDuration) revert CliffExceedsDuration();
        // The deployed contract intentionally uses block time with a 60-second
        // confirmation buffer.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > 60 && uint256(startTime) + 60 < block.timestamp) revert StartTimeInPast();

        uint48 cliffTime = startTime + cliffDuration;
        uint48 endTime = startTime + vestingDuration;

        uint256 scheduleId = _nextScheduleId;
        _schedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            revoked: false,
            startTime: startTime,
            cliffTime: cliffTime,
            endTime: endTime,
            revokeTime: 0,
            totalAmount: totalAmount,
            claimedAmount: 0
        });

        _beneficiarySchedules[beneficiary].push(scheduleId);
        _nextScheduleId = scheduleId + 1;

        usdc.safeTransferFrom(msg.sender, address(this), totalAmount);

        emit ScheduleCreated(scheduleId, beneficiary, totalAmount, startTime, cliffTime, endTime);
    }

    function claim(uint256 scheduleId) external whenNotPaused nonReentrant {
        VestingSchedule storage schedule = _schedules[scheduleId];
        if (schedule.totalAmount == 0) revert ScheduleNotFound();
        if (msg.sender != schedule.beneficiary) revert NotBeneficiary();

        uint128 vested = vestedAmount(scheduleId, block.timestamp);
        uint128 claimable = vested - schedule.claimedAmount;
        if (claimable == 0) revert NothingClaimable();

        schedule.claimedAmount += claimable;

        usdc.safeTransfer(schedule.beneficiary, claimable);

        emit Claimed(scheduleId, schedule.beneficiary, claimable);
    }

    function revoke(uint256 scheduleId) external onlyOwner nonReentrant {
        VestingSchedule storage schedule = _schedules[scheduleId];
        if (schedule.totalAmount == 0) revert ScheduleNotFound();
        if (schedule.revoked) revert AlreadyRevoked();
        if (schedule.claimedAmount == schedule.totalAmount) revert FullyClaimed();

        uint128 vestedNow = vestedAmount(scheduleId, block.timestamp);
        uint128 unvested = schedule.totalAmount - vestedNow;

        schedule.revoked = true;
        schedule.revokeTime = uint48(block.timestamp);

        if (unvested > 0) {
            usdc.safeTransfer(owner(), unvested);
        }

        emit ScheduleRevoked(scheduleId, schedule.beneficiary, unvested);
    }

    /// @notice Emergency function: if a beneficiary is blocklisted by USDC and cannot receive
    /// their vested tokens, the owner may push the stuck vested amount to the beneficiary.
    /// The recipient is always the schedule's own beneficiary — the owner cannot redirect funds
    /// to any other address via this function.
    function rescueStuckVesting(uint256 scheduleId) external onlyOwner nonReentrant {
        VestingSchedule storage schedule = _schedules[scheduleId];
        if (schedule.totalAmount == 0) revert ScheduleNotFound();
        uint128 stuckAmount = vestedAmount(scheduleId, block.timestamp) - schedule.claimedAmount;
        if (stuckAmount == 0) revert NothingClaimable();
        schedule.claimedAmount += stuckAmount;
        usdc.safeTransfer(schedule.beneficiary, stuckAmount);
        emit StuckVestingRescued(scheduleId, schedule.beneficiary, stuckAmount);
    }

    function vestedAmount(uint256 scheduleId, uint256 timestamp) public view returns (uint128) {
        VestingSchedule memory schedule = _schedules[scheduleId];
        if (schedule.totalAmount == 0) {
            return 0;
        }

        uint256 effectiveTs = timestamp;
        if (schedule.revoked && effectiveTs > schedule.revokeTime) {
            effectiveTs = schedule.revokeTime;
        }

        if (effectiveTs < schedule.cliffTime) {
            return 0;
        }

        if (effectiveTs >= schedule.endTime) {
            return schedule.totalAmount;
        }

        uint256 elapsed = effectiveTs - schedule.startTime;
        uint256 duration = schedule.endTime - schedule.startTime;

        // The ratio is <= 1 and totalAmount is already constrained to uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128((uint256(schedule.totalAmount) * elapsed) / duration);
    }

    function claimableAmount(uint256 scheduleId) external view returns (uint128) {
        VestingSchedule memory schedule = _schedules[scheduleId];
        return vestedAmount(scheduleId, block.timestamp) - schedule.claimedAmount;
    }

    function getSchedule(uint256 scheduleId) external view returns (VestingSchedule memory) {
        return _schedules[scheduleId];
    }

    function getScheduleIds(address beneficiary) external view returns (uint256[] memory) {
        return _beneficiarySchedules[beneficiary];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }
}
