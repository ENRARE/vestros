import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUseSelfServiceVault,
  isSelfServiceVaultOwner,
  scheduleRefKey,
} from './selfServiceWorkflow.ts'

void test('self-service writes require a connected wallet, configured factory, and matching chain', () => {
  assert.equal(canUseSelfServiceVault({
    connectedAddress: '0xAa00000000000000000000000000000000000001',
    vaultAddress: '0xBb00000000000000000000000000000000000002',
    vaultOwner: '0xAa00000000000000000000000000000000000001',
    connectedChainId: 5042002,
    expectedChainId: 5042002,
    factoryDeployed: true,
  }), true)

  assert.equal(canUseSelfServiceVault({
    connectedAddress: undefined,
    vaultAddress: undefined,
    vaultOwner: undefined,
    connectedChainId: undefined,
    expectedChainId: 5042002,
    factoryDeployed: true,
  }), false)

  assert.equal(canUseSelfServiceVault({
    connectedAddress: '0xAa00000000000000000000000000000000000001',
    vaultAddress: '0xBb00000000000000000000000000000000000002',
    vaultOwner: '0xAa00000000000000000000000000000000000001',
    connectedChainId: 1,
    expectedChainId: 5042002,
    factoryDeployed: true,
  }), false)
})

void test('a wallet cannot use another wallet vault', () => {
  assert.equal(isSelfServiceVaultOwner(
    '0xAa00000000000000000000000000000000000001',
    '0xAa00000000000000000000000000000000000001',
  ), true)
  assert.equal(isSelfServiceVaultOwner(
    '0xAa00000000000000000000000000000000000001',
    '0xBb00000000000000000000000000000000000002',
  ), false)
  assert.equal(isSelfServiceVaultOwner(undefined, '0xAa00000000000000000000000000000000000001'), false)
})

void test('schedule references remain unique across vaults with identical ids', () => {
  assert.notEqual(
    scheduleRefKey('0xAa00000000000000000000000000000000000001', 0n),
    scheduleRefKey('0xBb00000000000000000000000000000000000002', 0n),
  )
  assert.equal(
    scheduleRefKey('0xAa00000000000000000000000000000000000001', 3n),
    '0xaa00000000000000000000000000000000000001:3',
  )
})
