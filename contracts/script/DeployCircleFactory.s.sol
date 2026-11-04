// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {CircleFactory} from "../CircleFactory.sol";

/// @notice Testnet-only deployment entrypoint for the collective-signatures factory.
/// @dev Mainnet is intentionally rejected until the separate Circle review and
/// activation gates are complete.
contract DeployCircleFactory is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run(address usdc) external {
        require(usdc == ARC_USDC, "DeployCircleFactory: unexpected Arc USDC");
        require(block.chainid == 5042002, "DeployCircleFactory: must deploy on Arc Testnet (5042002)");

        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        bool hasRawKey = privateKey != 0;
        address deployer = hasRawKey ? vm.addr(privateKey) : msg.sender;
        require(deployer != FOUNDRY_DEFAULT_SENDER, "DeployCircleFactory: configure Ledger, keystore, or sender");

        console2.log("=== DeployCircleFactory ===");
        console2.log("Chain ID: ", block.chainid);
        console2.log("Network:  Arc Testnet");
        console2.log("Signer:   ", deployer);
        console2.log("USDC:     ", usdc);

        if (hasRawKey) vm.startBroadcast(privateKey);
        else vm.startBroadcast();

        CircleFactory factory = new CircleFactory(usdc);
        console2.log("Factory:  ", address(factory));

        vm.stopBroadcast();
    }
}
