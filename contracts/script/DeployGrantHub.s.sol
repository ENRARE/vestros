// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GrantPoolFactory} from "../GrantPoolFactory.sol";
import {GrantPool} from "../GrantPool.sol";
import {GrantVesting} from "../GrantVesting.sol";

// ── Shared helpers ─────────────────────────────────────────────────────────────
//
// SIGNING MODES
//   Testnet (PRIVATE_KEY set in env):
//     export PRIVATE_KEY=0x...
//     forge script ... --rpc-url arc_testnet --broadcast
//
//   Mainnet — hardware wallet (RECOMMENDED, no PRIVATE_KEY needed):
//     forge script ... --rpc-url arc_mainnet --broadcast --ledger
//
//   Mainnet — encrypted keystore (no PRIVATE_KEY needed):
//     cast wallet import vestros-deployer --interactive
//     forge script ... --rpc-url arc_mainnet --broadcast --account vestros-deployer
//
// Never pass --private-key on mainnet.

/// @dev Returns the effective broadcast address without requiring PRIVATE_KEY.
///      Foundry sets tx.origin to the active signer (ledger/keystore/key) before
///      run() executes, so vm.envOr + vm.startBroadcast() covers all modes.
library DeployLib {
    address constant FOUNDRY_DEFAULT_SENDER =
        0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function startBroadcast() internal returns (address deployer) {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key != 0) {
            deployer = vm.addr(key);
            vm.startBroadcast(key);
        } else {
            deployer = msg.sender;
            vm.startBroadcast();
        }
        require(
            deployer != FOUNDRY_DEFAULT_SENDER,
            "DeployGrantHub: no signer — pass --ledger, --account, or set PRIVATE_KEY"
        );
    }
}

// We need vm access inside the library but Script is a contract, not a library.
// Inline the Vm interface directly:
interface Vm {
    function envOr(string calldata, uint256) external returns (uint256);
    function addr(uint256) external returns (address);
    function startBroadcast(uint256) external;
    function startBroadcast() external;
}

/**
 * @title DeployGrantHub
 * @notice Deploys GrantPoolFactory (one per network).
 *
 *   Dry-run (no broadcast — safe, no funds required):
 *     forge script contracts/script/DeployGrantHub.s.sol \
 *       --rpc-url arc_mainnet \
 *       --sender $YOUR_WALLET \
 *       --sig "run(address)" 0x3600000000000000000000000000000000000000
 *
 *   Deploy — Ledger (mainnet recommended):
 *     forge script contracts/script/DeployGrantHub.s.sol \
 *       --rpc-url arc_mainnet --broadcast --ledger \
 *       --sig "run(address)" 0x3600000000000000000000000000000000000000
 *
 *   Deploy — keystore:
 *     forge script contracts/script/DeployGrantHub.s.sol \
 *       --rpc-url arc_mainnet --broadcast --account vestros-deployer \
 *       --sig "run(address)" 0x3600000000000000000000000000000000000000
 *
 *   Testnet (PRIVATE_KEY in env):
 *     forge script contracts/script/DeployGrantHub.s.sol \
 *       --rpc-url arc_testnet --broadcast \
 *       --sig "run(address)" 0x3600000000000000000000000000000000000000
 */
contract DeployGrantHub is Script {
    address constant FOUNDRY_DEFAULT_SENDER =
        0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run(address usdc) external {
        require(usdc != address(0), "DeployGrantHub: usdc cannot be zero");
        require(
            block.chainid == 5042002 || block.chainid == 5042,
            "DeployGrantHub: must deploy on Arc Testnet (5042002) or Arc Mainnet (5042)"
        );

        bool isMainnet = block.chainid == 5042;

        // Resolve deployer — supports raw key (testnet) or external signer (mainnet)
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (isMainnet) {
            require(key == 0, "DeployGrantHub: do not use PRIVATE_KEY on mainnet — use --ledger or --account");
        }

        address deployer;
        if (key != 0) {
            deployer = vm.addr(key);
        } else {
            deployer = msg.sender;
        }
        require(deployer != FOUNDRY_DEFAULT_SENDER,
            "DeployGrantHub: no signer — pass --ledger, --account, or set PRIVATE_KEY");

        console2.log("=== DeployGrantHub ===");
        console2.log("Chain ID:         ", block.chainid);
        console2.log("Network:          ", isMainnet ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Signing mode:     ", key != 0 ? "raw key" : "external signer (ledger/keystore)");
        console2.log("Deployer:         ", deployer);
        console2.log("USDC:             ", usdc);

        if (key != 0) {
            vm.startBroadcast(key);
        } else {
            vm.startBroadcast();
        }

        GrantPoolFactory factory = new GrantPoolFactory();
        console2.log("=== Deployed ===");
        console2.log("GrantPoolFactory: ", address(factory));

        vm.stopBroadcast();

        console2.log("--- NEXT STEPS ---");
        console2.log("1. Record factory address in AGENTS.md");
        console2.log("2. For each org: run DeployOrgPool with this factory address");
        console2.log("3. Transfer pool ownership to a multisig before accepting deposits");
    }
}

/**
 * @title DeployOrgPool
 * @notice Deploys GrantPool + GrantVesting for a single org, wires them, and logs next steps.
 *
 *   Dry-run:
 *     forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
 *       --rpc-url arc_mainnet \
 *       --sender $YOUR_WALLET \
 *       --sig "run(address,address,address,bytes32)" \
 *       <USDC> <FACTORY> <TREASURY> <SALT_HEX>
 *
 *   Deploy — Ledger:
 *     forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
 *       --rpc-url arc_mainnet --broadcast --ledger \
 *       --sig "run(address,address,address,bytes32)" \
 *       <USDC> <FACTORY> <TREASURY> <SALT_HEX>
 *
 * The pool owner is set to the deployer wallet.
 * Transfer to a Gnosis Safe immediately after for production use.
 */
contract DeployOrgPool is Script {
    address constant FOUNDRY_DEFAULT_SENDER =
        0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run(
        address usdc,
        address factory,
        address treasury,
        bytes32 salt
    ) external {
        require(usdc    != address(0), "DeployOrgPool: usdc zero");
        require(factory != address(0), "DeployOrgPool: factory zero");
        require(treasury != address(0), "DeployOrgPool: treasury zero");
        require(
            block.chainid == 5042002 || block.chainid == 5042,
            "DeployOrgPool: must deploy on Arc Testnet (5042002) or Arc Mainnet (5042)"
        );

        bool isMainnet = block.chainid == 5042;

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (isMainnet) {
            require(key == 0, "DeployOrgPool: do not use PRIVATE_KEY on mainnet — use --ledger or --account");
        }

        address deployer = (key != 0) ? vm.addr(key) : msg.sender;
        require(deployer != FOUNDRY_DEFAULT_SENDER,
            "DeployOrgPool: no signer — pass --ledger, --account, or set PRIVATE_KEY");

        console2.log("=== DeployOrgPool ===");
        console2.log("Chain ID:              ", block.chainid);
        console2.log("Network:               ", isMainnet ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Signing mode:          ", key != 0 ? "raw key" : "external signer (ledger/keystore)");
        console2.log("Deployer (pool owner): ", deployer);
        console2.log("USDC:                  ", usdc);
        console2.log("Factory:               ", factory);
        console2.log("Treasury:              ", treasury);
        console2.logBytes32(salt);

        if (key != 0) {
            vm.startBroadcast(key);
        } else {
            vm.startBroadcast();
        }

        // 1. Deploy pool via factory (namespaced by deployer + salt)
        address pool = GrantPoolFactory(factory).createPool(salt, usdc, treasury, deployer);
        console2.log("=== Deployed ===");
        console2.log("GrantPool:             ", pool);

        // 2. Deploy GrantVesting — pool must own it to call createSchedule
        GrantVesting vesting = new GrantVesting(usdc, pool);
        console2.log("GrantVesting:          ", address(vesting));

        // 3. Wire vesting into pool
        GrantPool(pool).setGrantVesting(address(vesting));
        console2.log("Wired: pool.grantVesting =", address(vesting));

        vm.stopBroadcast();

        console2.log("--- NEXT STEPS ---");
        console2.log("1. Record pool + vesting addresses in AGENTS.md");
        console2.log("2. Transfer pool ownership to a Gnosis Safe:");
        console2.log("   cast send <POOL> 'transferOwnership(address)' <SAFE> --rpc-url arc_mainnet --account vestros-deployer");
        console2.log("3. Call acceptOwnership() from the Safe");
        console2.log("4. Enable VITE_GRANTHUB_FINANCIAL=true in .env once audit is complete");
    }
}
