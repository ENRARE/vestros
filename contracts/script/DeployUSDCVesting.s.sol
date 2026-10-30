// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {USDCVesting} from "../USDCVesting.sol";

/**
 * @title  DeployUSDCVesting
 * @notice Deploys the core USDCVesting contract (Vestros MVP) to Arc Testnet or Arc Mainnet.
 *
 * USDCVesting hardcodes Arc USDC (0x3600000000000000000000000000000000000000),
 * which is the same precompile address on Arc Testnet (5042002) and Arc Mainnet (5042).
 *
 * ── Signing modes ──────────────────────────────────────────────────────────────────────────
 *
 *  a) External signer — Ledger hardware wallet (RECOMMENDED for mainnet):
 *       OWNER_ADDRESS=0x...  forge script contracts/script/DeployUSDCVesting.s.sol \
 *         --rpc-url arc_mainnet --broadcast --ledger \
 *         --sig "run(address)" $OWNER_ADDRESS
 *
 *  b) Encrypted keystore (cast wallet import):
 *       OWNER_ADDRESS=0x...  forge script contracts/script/DeployUSDCVesting.s.sol \
 *         --rpc-url arc_mainnet --broadcast --account <keystoreName> \
 *         --sig "run(address)" $OWNER_ADDRESS
 *
 *  c) Raw private key — testnet only, NEVER on mainnet:
 *       PRIVATE_KEY=0x...  OWNER_ADDRESS=0x...  forge script \
 *         contracts/script/DeployUSDCVesting.s.sol \
 *         --rpc-url arc_testnet --broadcast \
 *         --sig "run(address)" $OWNER_ADDRESS
 *
 * When PRIVATE_KEY is set the script uses it; when absent, Foundry's active signer
 * (--ledger, --account, --trezor) is used via vm.startBroadcast() with no argument.
 * The script refuses to broadcast if the effective sender is Foundry's default test
 * address (0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38).
 *
 * ── Dry-run (no broadcast, no funds required) ──────────────────────────────────────────────
 *       forge script contracts/script/DeployUSDCVesting.s.sol \
 *         --rpc-url arc_mainnet \
 *         --sig "run(address)" $OWNER_ADDRESS
 *   Omitting --broadcast causes Forge to simulate the deployment and print gas estimates
 *   without submitting any transaction.
 *
 * ── Post-deployment steps ──────────────────────────────────────────────────────────────────
 *   1. Record the deployed address in AGENTS.md and contracts/contract-metadata/.
 *   2. If initialOwner != deployer, call acceptOwnership() from initialOwner.
 *      (USDCVesting inherits Ownable2Step — ownership transfer is a two-step process.)
 *   3. Approve USDC on the new contract before calling createSchedule().
 *   4. Strongly recommended: transfer ownership to a Gnosis Safe or other multisig.
 *
 * Never hardcode private keys or addresses in this file.
 */
contract DeployUSDCVesting is Script {
    // Foundry's default test sender — deployment to a live chain with this sender
    // almost certainly means no real signer was configured.
    address internal constant FOUNDRY_DEFAULT_SENDER =
        0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run(address initialOwner) external {
        // ── Validate arguments ───────────────────────────────────────────────
        require(initialOwner != address(0),
            "DeployUSDCVesting: initialOwner cannot be zero address");

        // ── Chain guard ──────────────────────────────────────────────────────
        require(
            block.chainid == 5042002 || block.chainid == 5042,
            "DeployUSDCVesting: must run on Arc Testnet (5042002) or Arc Mainnet (5042)"
        );
        bool isMainnet = block.chainid == 5042;

        // ── Resolve signing mode ─────────────────────────────────────────────
        // Try to read PRIVATE_KEY. envOr returns 0 when the variable is absent.
        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        bool hasRawKey     = privateKey != 0;

        // On mainnet, refuse to use a raw private key — require hardware/keystore.
        if (isMainnet && hasRawKey) {
            revert("DeployUSDCVesting: raw PRIVATE_KEY must not be used on mainnet. "
                   "Use --ledger or --account <keystoreName> instead.");
        }

        // Determine the effective deployer address before broadcasting.
        address deployer = hasRawKey
            ? vm.addr(privateKey)
            : msg.sender; // set by Foundry to the --sender / --ledger / --account address

        // Guard against Foundry's default test sender on any live chain.
        require(deployer != FOUNDRY_DEFAULT_SENDER,
            "DeployUSDCVesting: effective sender is Foundry's default test address. "
            "Pass --sender, --ledger, or --account to identify a real deployer.");

        // ── Pre-flight summary ───────────────────────────────────────────────
        console2.log("=== DeployUSDCVesting ===");
        console2.log("Chain ID:        ", block.chainid);
        console2.log("Network:         ", isMainnet ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Signing mode:    ", hasRawKey ? "raw key (env)" : "external signer (ledger/keystore)");
        console2.log("Deployer:        ", deployer);
        console2.log("Initial owner:   ", initialOwner);
        console2.log("USDC (hardcoded):", address(0x3600000000000000000000000000000000000000));

        if (initialOwner != deployer) {
            console2.log("NOTE: initialOwner != deployer.");
            console2.log("      Call acceptOwnership() from initialOwner after deployment.");
        }

        // ── Deploy ───────────────────────────────────────────────────────────
        if (hasRawKey) {
            vm.startBroadcast(privateKey);
        } else {
            vm.startBroadcast();   // uses --ledger / --account / --trezor signer
        }

        USDCVesting vesting = new USDCVesting(initialOwner);

        vm.stopBroadcast();

        // ── Post-deployment summary ──────────────────────────────────────────
        console2.log("=== Deployed ===");
        console2.log("USDCVesting:     ", address(vesting));
        console2.log("");
        console2.log("--- NEXT STEPS ---");
        console2.log("1. Verify on explorer: https://explorer.arc.io/address/",
                     address(vesting));
        if (initialOwner != deployer) {
            console2.log("2. Call acceptOwnership() from:", initialOwner);
        }
        console2.log("3. Approve USDC on this contract before createSchedule()");
        console2.log("4. Record address in AGENTS.md and contract-metadata/");
    }
}
