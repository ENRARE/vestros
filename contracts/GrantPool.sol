// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GrantVesting} from "./GrantVesting.sol";

/// @title GrantPool
/// @notice Manages USDC deposits and grant awards for a single grant program.
///         Each pool is owned by an organization; any address may deposit.
contract GrantPool is Pausable, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Errors ────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error InvalidAward();
    error VestingDaysZero();
    error CliffExceedsVesting();
    error InsufficientConfirmedBalance();
    error AwardAlreadyActivated();
    error AwardAlreadyCancelled();
    error AwardNotCancellable();
    error VestingScheduleCreationFailed();
    error GrantVestingNotSet();
    error DurationOverflow();
    error NothingToSync();

    // ── Events ────────────────────────────────────────────────────────────────
    event Deposited(address indexed depositor, uint256 amount);
    event AwardCreated(uint256 indexed awardId, address indexed beneficiary, uint256 amount);
    /// @param vestingCliffDays   Suggested cliff for the vesting schedule.
    /// @param vestingDays        Suggested total duration for the vesting schedule.
    /// @param vestingScheduleId  Schedule id created in the configured GrantVesting contract.
    /// @param vestingContract    GrantVesting contract used for schedule creation.
    event AwardActivated(
        uint256 indexed awardId,
        address indexed beneficiary,
        uint256 amount,
        uint32 vestingCliffDays,
        uint32 vestingDays,
        uint256 vestingScheduleId,
        address vestingContract
    );
    event AwardCancelled(uint256 indexed awardId);
    event Withdrawn(address indexed to, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event GrantVestingUpdated(address indexed prev, address indexed next);

    // ── Storage ───────────────────────────────────────────────────────────────
    struct Award {
        address beneficiary;
        uint256 amount;
        uint32  cliffDays;
        uint32  vestingDays;
        uint256 vestingScheduleId;
        bool    activated;
        bool    cancelled;
    }

    address public immutable usdc;
    address public treasury;
    address public grantVesting;

    /// @notice Actual USDC held in the pool minus amounts committed to pending awards.
    uint256 public confirmedBalance;
    /// @notice Sum of amounts for awards that have been created but not yet activated or cancelled.
    uint256 public committedBalance;

    Award[] public awards;

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address usdc_, address treasury_, address initialOwner) Ownable(initialOwner) {
        // initialOwner == address(0) is already caught by OZ Ownable's base constructor.
        if (usdc_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        usdc     = usdc_;
        treasury = treasury_;
    }

    // ── External: deposit ─────────────────────────────────────────────────────
    /// @notice Transfer USDC into this pool. Uses balance-delta accounting to
    ///         handle fee-on-transfer tokens gracefully (USDC has no fee, but
    ///         the pattern is robust).
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

        IERC20 token = IERC20(usdc);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        confirmedBalance += received;
        emit Deposited(msg.sender, received);
    }

    // ── External: award lifecycle ─────────────────────────────────────────────
    /// @notice Owner creates an award commitment against confirmed pool balance.
    function createAward(
        address beneficiary,
        uint256 amount,
        uint32  cliffDays,
        uint32  vestingDays
    ) external onlyOwner whenNotPaused returns (uint256 awardId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount      == 0)          revert ZeroAmount();
        if (vestingDays == 0)          revert VestingDaysZero();
        if (cliffDays > vestingDays)   revert CliffExceedsVesting();
        if (confirmedBalance < amount) revert InsufficientConfirmedBalance();

        confirmedBalance -= amount;
        committedBalance += amount;

        awards.push(Award({
            beneficiary: beneficiary,
            amount: amount,
            cliffDays: cliffDays,
            vestingDays: vestingDays,
            vestingScheduleId: 0,
            activated: false,
            cancelled: false
        }));

        awardId = awards.length - 1;
        emit AwardCreated(awardId, beneficiary, amount);
    }

    /// @notice Owner activates an award, atomically funding a vesting schedule in the
    ///         configured GrantVesting contract. Reverts if no vesting contract is set.
    function activateAward(uint256 awardId) external onlyOwner whenNotPaused nonReentrant {
        if (awardId >= awards.length) revert InvalidAward();

        Award storage award = awards[awardId];
        if (award.cancelled) revert AwardAlreadyCancelled();
        if (award.activated) revert AwardAlreadyActivated();

        award.activated   = true;
        committedBalance -= award.amount;

        uint256 vestingScheduleId;

        address vestingContract = grantVesting;
        if (vestingContract == address(0)) revert GrantVestingNotSet();

        IERC20 token = IERC20(usdc);
        uint256 cliffDuration  = uint256(award.cliffDays)   * 1 days;
        uint256 vestingDuration = uint256(award.vestingDays) * 1 days;
        if (cliffDuration  > type(uint48).max || vestingDuration > type(uint48).max) revert DurationOverflow();

        token.forceApprove(vestingContract, award.amount);
        try GrantVesting(vestingContract).createSchedule(
            award.beneficiary,
            award.amount,
            uint48(block.timestamp),
            uint48(cliffDuration),
            uint48(vestingDuration)
        ) returns (uint256 createdScheduleId) {
            vestingScheduleId = createdScheduleId;
            award.vestingScheduleId = createdScheduleId;
            token.forceApprove(vestingContract, 0);
        } catch (bytes memory reason) {
            token.forceApprove(vestingContract, 0);
            if (reason.length > 0) {
                assembly ("memory-safe") {
                    revert(add(reason, 32), mload(reason))
                }
            }
            revert VestingScheduleCreationFailed();
        }

        emit AwardActivated(
            awardId,
            award.beneficiary,
            award.amount,
            award.cliffDays,
            award.vestingDays,
            vestingScheduleId,
            vestingContract
        );
    }

    /// @notice Owner cancels an unactivated award, returning its amount to confirmedBalance.
    function cancelAward(uint256 awardId) external onlyOwner whenNotPaused {
        if (awardId >= awards.length) revert InvalidAward();

        Award storage award = awards[awardId];
        if (award.activated) revert AwardNotCancellable();
        if (award.cancelled) revert AwardAlreadyCancelled();

        award.cancelled   = true;
        committedBalance -= award.amount;
        confirmedBalance += award.amount;

        emit AwardCancelled(awardId);
    }

    /// @notice Owner withdraws unallocated pool balance to the treasury.
    function withdraw(uint256 amount) external onlyOwner whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (confirmedBalance < amount) revert InsufficientConfirmedBalance();

        confirmedBalance -= amount;
        IERC20(usdc).safeTransfer(treasury, amount);
        emit Withdrawn(treasury, amount);
    }

    // ── External: admin ───────────────────────────────────────────────────────
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address prev = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(prev, newTreasury);
    }

    function setGrantVesting(address gv) external onlyOwner {
        if (gv == address(0)) revert ZeroAddress();
        address prev = grantVesting;
        grantVesting = gv;
        emit GrantVestingUpdated(prev, gv);
    }

    function revokeVestingSchedule(uint256 scheduleId) external onlyOwner whenNotPaused {
        address vestingContract = grantVesting;
        if (vestingContract == address(0)) revert GrantVestingNotSet();
        GrantVesting(vestingContract).revoke(scheduleId);
    }

    /// @notice Pause the configured GrantVesting contract. Emergency use only.
    function pauseVesting() external onlyOwner {
        address vestingContract = grantVesting;
        if (vestingContract == address(0)) revert GrantVestingNotSet();
        GrantVesting(vestingContract).pause();
    }

    /// @notice Unpause the configured GrantVesting contract.
    function unpauseVesting() external onlyOwner {
        address vestingContract = grantVesting;
        if (vestingContract == address(0)) revert GrantVestingNotSet();
        GrantVesting(vestingContract).unpause();
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Ownership renouncement is disabled. Losing ownership permanently
    ///         prevents unpause and admin operations.
    function renounceOwnership() public pure override {
        revert("GrantPool: renounceOwnership disabled");
    }

    /// @notice Reconciles confirmedBalance with any USDC sent directly to this
    ///         contract (bypassing deposit()). Recovers stranded tokens into
    ///         confirmedBalance so they can be withdrawn to the treasury.
    function syncBalance() external onlyOwner {
        uint256 actual  = IERC20(usdc).balanceOf(address(this));
        uint256 tracked = confirmedBalance + committedBalance;
        if (actual <= tracked) revert NothingToSync();
        confirmedBalance += actual - tracked;
    }

    // ── View ──────────────────────────────────────────────────────────────────
    function awardsCount() external view returns (uint256) { return awards.length; }
}
