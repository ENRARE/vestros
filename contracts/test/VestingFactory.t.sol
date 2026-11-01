// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MockERC20} from "../test-helpers/MockERC20.sol";
import {SelfServiceVesting} from "../SelfServiceVesting.sol";
import {VestingFactory} from "../VestingFactory.sol";

contract VestingFactoryTest is Test {
    MockERC20 internal usdc;
    VestingFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        factory = new VestingFactory(address(usdc));
    }

    function test_CreateVault_AssignsCreatorAndRegistersOnce() public {
        vm.prank(alice);
        address vaultAddress = factory.createVault();

        SelfServiceVesting vault = SelfServiceVesting(vaultAddress);
        assertEq(address(factory.usdc()), address(usdc));
        assertEq(factory.vaultOf(alice), vaultAddress);
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), vaultAddress);
        assertEq(vault.owner(), alice);
        assertEq(vault.pendingOwner(), address(0));
        assertTrue(vault.owner() != address(factory));
    }

    function test_CreateVault_RevertsForDuplicateCreator() public {
        vm.prank(alice);
        factory.createVault();

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            VestingFactory.VaultAlreadyExists.selector,
            alice,
            factory.vaultOf(alice)
        ));
        factory.createVault();
        vm.stopPrank();
    }

    function test_CreateVault_IsolatesIndependentCreators() public {
        vm.prank(alice);
        address aliceVault = factory.createVault();
        vm.prank(bob);
        address bobVault = factory.createVault();

        assertTrue(aliceVault != bobVault);
        assertEq(SelfServiceVesting(aliceVault).owner(), alice);
        assertEq(SelfServiceVesting(bobVault).owner(), bob);
        assertEq(factory.vaultCount(), 2);
    }

    function test_CreateVault_RevertsForZeroUsdc() public {
        vm.expectRevert(VestingFactory.ZeroUsdc.selector);
        new VestingFactory(address(0));
    }

    function test_FactoryCannotAdministerCreatedVault() public {
        vm.prank(alice);
        address vaultAddress = factory.createVault();

        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(
            Ownable.OwnableUnauthorizedAccount.selector,
            address(factory)
        ));
        SelfServiceVesting(vaultAddress).pause();
    }

    function test_VaultAt_RevertsForOutOfBoundsIndex() public {
        vm.expectRevert();
        factory.vaultAt(0);
    }

    function test_CreateVault_EmitsCreatorAndVaultAddresses() public {
        vm.recordLogs();
        vm.prank(alice);
        address vaultAddress = factory.createVault();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 expectedTopic = keccak256("VaultCreated(address,address)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), alice);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), vaultAddress);
                found = true;
            }
        }
        assertTrue(found, "VaultCreated event not found");
    }
}
