// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract GrantVesting is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error VestingDurationZero();
    error CliffExceedsVesting();
    error NotBeneficiary();
    error NothingToClaim();
    error AlreadyRevoked();
    error ScheduleNotFound();

    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 cliffTime,
        uint48 endTime
    );
    event Claimed(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event Revoked(uint256 indexed scheduleId, uint256 unvested);

    struct Schedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint48 startTime;
        uint48 cliffTime;
        uint48 endTime;
        uint48 revokeTime;
        bool revoked;
    }

    address public immutable usdc;
    Schedule[] private _schedules;
    mapping(address => uint256[]) private _beneficiarySchedules;

    constructor(address usdc_, address initialOwner) Ownable(initialOwner) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint48 startTime,
        uint48 cliffDuration,
        uint48 vestingDuration
    ) external onlyOwner whenNotPaused returns (uint256 scheduleId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (vestingDuration == 0) revert VestingDurationZero();
        if (cliffDuration > vestingDuration) revert CliffExceedsVesting();

        uint48 cliffTime = startTime + cliffDuration;
        uint48 endTime = startTime + vestingDuration;

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);

        _schedules.push(
            Schedule({
                beneficiary: beneficiary,
                totalAmount: amount,
                claimedAmount: 0,
                startTime: startTime,
                cliffTime: cliffTime,
                endTime: endTime,
                revokeTime: 0,
                revoked: false
            })
        );

        scheduleId = _schedules.length - 1;
        _beneficiarySchedules[beneficiary].push(scheduleId);

        emit ScheduleCreated(scheduleId, beneficiary, amount, startTime, cliffTime, endTime);
    }

    function claim(uint256 scheduleId) external whenNotPaused nonReentrant {
        Schedule storage schedule = _getSchedule(scheduleId);
        if (msg.sender != schedule.beneficiary) revert NotBeneficiary();

        uint256 claimable = vestedAmount(scheduleId) - schedule.claimedAmount;
        if (claimable == 0) revert NothingToClaim();

        schedule.claimedAmount += claimable;
        IERC20(usdc).safeTransfer(schedule.beneficiary, claimable);

        emit Claimed(scheduleId, schedule.beneficiary, claimable);
    }

    function revoke(uint256 scheduleId) external onlyOwner whenNotPaused nonReentrant returns (uint256 unvested) {
        Schedule storage schedule = _getSchedule(scheduleId);
        if (schedule.revoked) revert AlreadyRevoked();

        uint48 revokeTime = uint48(block.timestamp);
        uint256 vestedAtRevoke = _vestedAmountAt(schedule, revokeTime);
        unvested = schedule.totalAmount - vestedAtRevoke;

        schedule.revoked = true;
        schedule.revokeTime = revokeTime;

        if (unvested > 0) {
            IERC20(usdc).safeTransfer(owner(), unvested);
        }

        emit Revoked(scheduleId, unvested);
    }

    function vestedAmount(uint256 scheduleId) public view returns (uint256) {
        Schedule storage schedule = _getSchedule(scheduleId);
        return _vestedAmountAt(schedule, block.timestamp);
    }

    function claimableAmount(uint256 scheduleId) public view returns (uint256) {
        Schedule storage schedule = _getSchedule(scheduleId);
        return _vestedAmountAt(schedule, block.timestamp) - schedule.claimedAmount;
    }

    function getSchedule(uint256 scheduleId) external view returns (Schedule memory) {
        return _getSchedule(scheduleId);
    }

    function getScheduleIds(address beneficiary) external view returns (uint256[] memory) {
        return _beneficiarySchedules[beneficiary];
    }

    function schedulesCount() external view returns (uint256) {
        return _schedules.length;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Ownership renouncement is disabled. Losing ownership permanently
    ///         prevents unpause and schedule creation.
    function renounceOwnership() public pure override {
        revert("GrantVesting: renounceOwnership disabled");
    }

    function _vestedAmountAt(Schedule storage schedule, uint256 timestamp) internal view returns (uint256) {
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
        return (schedule.totalAmount * elapsed) / duration;
    }

    function _getSchedule(uint256 scheduleId) internal view returns (Schedule storage schedule) {
        if (scheduleId >= _schedules.length) revert ScheduleNotFound();
        schedule = _schedules[scheduleId];
    }
}
