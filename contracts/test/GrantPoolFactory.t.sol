// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GrantPoolFactory} from "../GrantPoolFactory.sol";
import {GrantPool} from "../GrantPool.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract GrantPoolFactoryTest is Test {
    GrantPoolFactory internal factory;
    MockERC20        internal usdc;

    address internal deployer  = makeAddr("deployer");
    address internal poolOwner = makeAddr("poolOwner");
    address internal treasury  = makeAddr("treasury");

    bytes32 internal constant SALT_A = keccak256("org-a/pool-1");
    bytes32 internal constant SALT_B = keccak256("org-b/pool-1");

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        factory = new GrantPoolFactory();
    }

    // ── createPool happy path ─────────────────────────────────────────────────

    function test_CreatePool_HappyPath_ReturnsNonZeroAddress() public {
        address pool = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertTrue(pool != address(0));
    }

    function test_CreatePool_HappyPath_RegistersInMapping() public {
        address pool = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(factory.getPool(SALT_A, address(this)), pool);
    }

    function test_CreatePool_HappyPath_EmitsPoolCreated() public {
        // Pre-compute the CREATE2 address. CREATE2 salt is keccak256(abi.encode(caller, userSalt)).
        bytes32 key = keccak256(abi.encode(address(this), SALT_A));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(GrantPool).creationCode,
                abi.encode(address(usdc), treasury, poolOwner)
            )
        );
        address predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(factory),
                key,
                initCodeHash
            ))))
        );

        // The event emits the user-supplied salt, not the namespaced key.
        vm.expectEmit(true, true, true, false, address(factory));
        emit GrantPoolFactory.PoolCreated(SALT_A, predicted, poolOwner);
        factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
    }

    function test_CreatePool_HappyPath_PoolOwnerIsPoolOwner() public {
        address poolAddr = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(GrantPool(poolAddr).owner(), poolOwner);
    }

    function test_CreatePool_HappyPath_PoolUsdcSet() public {
        address poolAddr = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(GrantPool(poolAddr).usdc(), address(usdc));
    }

    function test_CreatePool_HappyPath_PoolTreasurySet() public {
        address poolAddr = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(GrantPool(poolAddr).treasury(), treasury);
    }

    function test_CreatePool_HappyPath_DifferentSaltsAreDifferentPools() public {
        address poolA = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        address poolB = factory.createPool(SALT_B, address(usdc), treasury, poolOwner);
        assertTrue(poolA != poolB);
    }

    /// CREATE2: address is deterministic — same factory + same caller + same salt → same address.
    function test_CreatePool_DeterministicAddress_ViaCREATE2() public {
        // The CREATE2 salt is keccak256(abi.encode(caller, userSalt))
        bytes32 key = keccak256(abi.encode(address(this), SALT_A));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(GrantPool).creationCode,
                abi.encode(address(usdc), treasury, poolOwner)
            )
        );
        address expected = address(
            uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(factory),
                key,
                initCodeHash
            ))))
        );

        address actual = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(actual, expected);
    }

    // ── createPool revert paths ───────────────────────────────────────────────

    function test_CreatePool_Revert_PoolAlreadyExists() public {
        factory.createPool(SALT_A, address(usdc), treasury, poolOwner);

        vm.expectRevert(GrantPoolFactory.PoolAlreadyExists.selector);
        factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
    }

    function test_CreatePool_Revert_ZeroUsdc() public {
        vm.expectRevert(GrantPoolFactory.ZeroAddress.selector);
        factory.createPool(SALT_A, address(0), treasury, poolOwner);
    }

    function test_CreatePool_Revert_ZeroTreasury() public {
        vm.expectRevert(GrantPoolFactory.ZeroAddress.selector);
        factory.createPool(SALT_A, address(usdc), address(0), poolOwner);
    }

    function test_CreatePool_Revert_ZeroPoolOwner() public {
        vm.expectRevert(GrantPoolFactory.ZeroAddress.selector);
        factory.createPool(SALT_A, address(usdc), treasury, address(0));
    }

    // ── getPool view ──────────────────────────────────────────────────────────

    function test_GetPool_ReturnsZeroForUnknownSalt() public view {
        assertEq(factory.getPool(SALT_A, address(this)), address(0));
    }

    function test_GetPool_ReturnsDeployedAddress() public {
        address pool = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(factory.getPool(SALT_A, address(this)), pool);
    }

    function test_GetPool_SaltBIndependentOfSaltA() public {
        factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        assertEq(factory.getPool(SALT_B, address(this)), address(0));
    }

    function test_GetPool_DifferentCallersDontCollide() public {
        address caller1 = makeAddr("caller1");
        address caller2 = makeAddr("caller2");
        vm.prank(caller1);
        address p1 = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);
        // same salt, different caller — must not collide
        assertEq(factory.getPool(SALT_A, caller1), p1);
        assertEq(factory.getPool(SALT_A, caller2), address(0));
    }

    // ── onlyOwner guards (factory has none — it is permissionless) ────────────
    // Any address may call createPool. Verify two different callers get distinct pools.

    function test_CreatePool_AnyCallerCanCreate() public {
        address caller1 = makeAddr("caller1");
        address caller2 = makeAddr("caller2");

        vm.prank(caller1);
        address p1 = factory.createPool(SALT_A, address(usdc), treasury, poolOwner);

        vm.prank(caller2);
        address p2 = factory.createPool(SALT_B, address(usdc), treasury, poolOwner);

        assertTrue(p1 != address(0));
        assertTrue(p2 != address(0));
        assertTrue(p1 != p2);
    }

    // ── Fuzz: salt collision ──────────────────────────────────────────────────

    function testFuzz_CreatePool_UniqueSaltsNeverCollide(
        bytes32 saltA,
        bytes32 saltB
    ) public {
        vm.assume(saltA != saltB);

        address p1 = factory.createPool(saltA, address(usdc), treasury, poolOwner);
        address p2 = factory.createPool(saltB, address(usdc), treasury, poolOwner);

        assertTrue(p1 != p2, "CREATE2: same factory, different salts must yield different addresses");
        assertEq(factory.getPool(saltA, address(this)), p1);
        assertEq(factory.getPool(saltB, address(this)), p2);
    }

    function testFuzz_CreatePool_DuplicateSaltAlwaysReverts(bytes32 salt) public {
        factory.createPool(salt, address(usdc), treasury, poolOwner);

        vm.expectRevert(GrantPoolFactory.PoolAlreadyExists.selector);
        factory.createPool(salt, address(usdc), treasury, poolOwner);
    }
}
