// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GrantPool} from "./GrantPool.sol";

/// @title GrantPoolFactory
/// @notice Permissionless CREATE2 factory for GrantPool instances.
///         Each pool is scoped to a single grant program and owned by the caller.
contract GrantPoolFactory {
    error PoolAlreadyExists();
    error ZeroAddress();

    event PoolCreated(bytes32 indexed salt, address indexed pool, address indexed owner);

    mapping(bytes32 salt => address pool) public pools;

    /// @param salt       Deterministic deployment key (e.g. keccak256(orgId, counter)).
    /// @param usdc       USDC token address (e.g. 0x3600...0000 on Arc Testnet).
    /// @param treasury   Address that receives unallocated withdrawals.
    /// @param poolOwner  Initial owner of the deployed pool (typically msg.sender's org wallet).
    function createPool(
        bytes32 salt,
        address usdc,
        address treasury,
        address poolOwner
    ) external returns (address pool) {
        bytes32 key = keccak256(abi.encode(msg.sender, salt));
        if (pools[key] != address(0)) revert PoolAlreadyExists();
        if (usdc == address(0) || treasury == address(0) || poolOwner == address(0)) {
            revert ZeroAddress();
        }

        pool = address(new GrantPool{salt: key}(usdc, treasury, poolOwner));
        pools[key] = pool;

        emit PoolCreated(salt, pool, poolOwner);
    }

    function getPool(bytes32 salt, address caller) external view returns (address) {
        return pools[keccak256(abi.encode(caller, salt))];
    }
}
