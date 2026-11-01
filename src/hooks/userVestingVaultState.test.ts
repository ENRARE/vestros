import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canCreateUserVault,
  normalizeVaultAddress,
  SELF_SERVICE_UNAVAILABLE_COPY,
  SELF_SERVICE_UNAVAILABLE_TITLE,
  userVaultStateKey,
} from './userVestingVaultState.ts'

void test('requires a connected wallet on the active chain and an empty factory slot', () => {
  const base = {
    isConnected: true,
    activeChainId: 5042002,
    connectedChainId: 5042002,
    factoryDeployed: true,
    vaultAddress: undefined,
  }

  assert.equal(canCreateUserVault(base), true)
  assert.equal(canCreateUserVault({ ...base, isConnected: false }), false)
  assert.equal(canCreateUserVault({ ...base, connectedChainId: 5042 }), false)
  assert.equal(canCreateUserVault({ ...base, factoryDeployed: false }), false)
  assert.equal(canCreateUserVault({ ...base, vaultAddress: '0x1111111111111111111111111111111111111111' }), false)
})

void test('normalizes zero vault reads and isolates wallet/chain state keys', () => {
  assert.equal(normalizeVaultAddress(undefined), undefined)
  assert.equal(normalizeVaultAddress('0x0000000000000000000000000000000000000000'), undefined)
  assert.equal(normalizeVaultAddress('0x1111111111111111111111111111111111111111'), '0x1111111111111111111111111111111111111111')
  assert.notEqual(
    userVaultStateKey('0x1111111111111111111111111111111111111111', 5042002),
    userVaultStateKey('0x2222222222222222222222222222222222222222', 5042002),
  )
  assert.notEqual(
    userVaultStateKey('0x1111111111111111111111111111111111111111', 5042002),
    userVaultStateKey('0x1111111111111111111111111111111111111111', 5042),
  )
})

void test('uses a user-facing unavailable state instead of exposing environment configuration', () => {
  assert.equal(SELF_SERVICE_UNAVAILABLE_TITLE, 'Self-service vaults unavailable')
  assert.match(SELF_SERVICE_UNAVAILABLE_COPY, /deployed and verified on Arc Testnet/)
  assert.doesNotMatch(SELF_SERVICE_UNAVAILABLE_COPY, /VITE_|VestingFactory address configured/)
})
