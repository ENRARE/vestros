// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeployGrantHub, DeployOrgPool} from "../script/DeployGrantHub.s.sol";
import {DeployVestingFactory} from "../script/DeployVestingFactory.s.sol";
import {DeployCircleFactory} from "../script/DeployCircleFactory.s.sol";

contract DeploymentScriptGuardsTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant NOT_USDC = 0x0000000000000000000000000000000000000001;

    function test_GrantHubFactoryRejectsNonCanonicalUsdc() public {
        DeployGrantHub script = new DeployGrantHub();
        vm.expectRevert(bytes("DeployGrantHub: unexpected Arc USDC"));
        script.run(NOT_USDC);
    }

    function test_GrantOrgPoolRejectsNonCanonicalUsdc() public {
        DeployOrgPool script = new DeployOrgPool();
        vm.expectRevert(bytes("DeployOrgPool: unexpected Arc USDC"));
        script.run(NOT_USDC, address(2), address(3), bytes32(0));
    }

    function test_VestingFactoryRejectsNonCanonicalUsdc() public {
        DeployVestingFactory script = new DeployVestingFactory();
        vm.expectRevert(bytes("DeployVestingFactory: unexpected Arc USDC"));
        script.run(NOT_USDC);
    }

    function test_CircleFactoryRejectsNoncanonicalUsdc() public {
        DeployCircleFactory script = new DeployCircleFactory();
        vm.expectRevert(bytes("DeployCircleFactory: unexpected Arc USDC"));
        script.run(NOT_USDC);
    }

    function test_CircleFactoryIsTestnetOnly() public {
        DeployCircleFactory script = new DeployCircleFactory();
        vm.chainId(5042);
        vm.expectRevert(bytes("DeployCircleFactory: must deploy on Arc Testnet (5042002)"));
        script.run(ARC_USDC);
    }

    function test_DeploymentScriptsRejectUnsupportedChainBeforeSigning() public {
        vm.chainId(1);
        DeployGrantHub grantHub = new DeployGrantHub();
        DeployVestingFactory factory = new DeployVestingFactory();
        DeployCircleFactory circleFactory = new DeployCircleFactory();

        vm.expectRevert(bytes("DeployGrantHub: must deploy on Arc Testnet (5042002) or Arc Mainnet (5042)"));
        grantHub.run(ARC_USDC);

        vm.expectRevert(bytes("DeployVestingFactory: unsupported Arc chain"));
        factory.run(ARC_USDC);

        vm.expectRevert(bytes("DeployCircleFactory: must deploy on Arc Testnet (5042002)"));
        circleFactory.run(ARC_USDC);
    }
}
