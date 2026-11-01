// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SelfServiceVesting} from "./SelfServiceVesting.sol";

/// @notice Permissionless registry for one self-service vesting vault per wallet.
contract VestingFactory {
    error ZeroUsdc();
    error VaultAlreadyExists(address creator, address vault);

    event VaultCreated(address indexed creator, address indexed vault);

    IERC20 public immutable usdc;
    mapping(address => address) public vaultOf;
    address[] private _vaults;

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroUsdc();
        usdc = IERC20(usdc_);
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function createVault() external returns (address vault) {
        address existing = vaultOf[msg.sender];
        if (existing != address(0)) revert VaultAlreadyExists(msg.sender, existing);

        vault = address(new SelfServiceVesting(address(usdc), msg.sender));
        vaultOf[msg.sender] = vault;
        _vaults.push(vault);

        emit VaultCreated(msg.sender, vault);
    }
}
