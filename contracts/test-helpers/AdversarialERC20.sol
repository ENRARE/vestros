// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev ERC-20-shaped test doubles for validating SafeERC20 failure handling.
contract FalseReturningERC20 {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract RevertingERC20 {
    error TransferBlocked();

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert TransferBlocked();
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert TransferBlocked();
    }
}
