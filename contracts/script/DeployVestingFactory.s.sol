// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {VestingFactory} from "../VestingFactory.sol";

/// @notice Simulation/deployment entrypoint for the permissionless self-service factory.
contract DeployVestingFactory is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant FOUNDRY_DEFAULT_SENDER =
        0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run(address usdc) external {
        require(usdc == ARC_USDC, "DeployVestingFactory: unexpected Arc USDC");
        require(
            block.chainid == 5042002 || block.chainid == 5042,
            "DeployVestingFactory: unsupported Arc chain"
        );

        bool isMainnet = block.chainid == 5042;
        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        bool hasRawKey = privateKey != 0;
        if (isMainnet && hasRawKey) {
            revert("DeployVestingFactory: use --ledger or --account on Mainnet");
        }

        address deployer = hasRawKey ? vm.addr(privateKey) : msg.sender;
        require(
            deployer != FOUNDRY_DEFAULT_SENDER,
            "DeployVestingFactory: configure Ledger, keystore, or sender"
        );

        console2.log("=== DeployVestingFactory ===");
        console2.log("Chain ID: ", block.chainid);
        console2.log("Network:  ", isMainnet ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Signer:   ", deployer);
        console2.log("USDC:     ", usdc);

        if (hasRawKey) vm.startBroadcast(privateKey);
        else vm.startBroadcast();

        VestingFactory factory = new VestingFactory(usdc);
        console2.log("Factory:  ", address(factory));

        vm.stopBroadcast();
    }
}
