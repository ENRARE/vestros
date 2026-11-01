import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_USDC,
  evaluateMainnetPreflight,
} from './mainnetPreflight.ts'

const VALID_CORE = '0x1111111111111111111111111111111111111111'
const VALID_FACTORY = '0x2222222222222222222222222222222222222222'
const VALID_HASH = `0x${'ab'.repeat(32)}`

void test('factory-only release scope does not require legacy Core deployment', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory'],
    configuredChainId: ARC_MAINNET_CHAIN_ID,
    rpcChainId: ARC_MAINNET_CHAIN_ID,
    factoryAddress: VALID_FACTORY,
    factoryCodePresent: true,
    factoryUsdc: ARC_MAINNET_USDC,
    expectedFactoryRuntimeCodeHash: VALID_HASH,
    observedFactoryRuntimeCodeHash: VALID_HASH,
  })

  assert.equal(result.status, 'ready')
  assert.ok(result.checks.some(check => check.id === 'core-address' && check.status === 'not-applicable'))
  assert.ok(result.checks.some(check => check.id === 'factory-runtime' && check.status === 'pass'))
})

void test('Mainnet preflight never treats missing addresses as deployed', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory', 'legacy'],
    configuredChainId: ARC_MAINNET_CHAIN_ID,
    rpcChainId: ARC_MAINNET_CHAIN_ID,
  })

  assert.equal(result.status, 'blocked')
  assert.ok(result.checks.some(check => check.id === 'core-address' && check.status === 'blocked'))
  assert.ok(result.checks.some(check => check.id === 'factory-address' && check.status === 'blocked'))
})

void test('Mainnet preflight rejects a Testnet chain or token', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory', 'legacy'],
    configuredChainId: 5042002,
    rpcChainId: 5042002,
    vestingAddress: VALID_CORE,
    factoryAddress: VALID_FACTORY,
    vestingCodePresent: true,
    factoryCodePresent: true,
    vestingUsdc: ARC_MAINNET_USDC,
    factoryUsdc: ARC_MAINNET_USDC,
    expectedFactoryRuntimeCodeHash: VALID_HASH,
    observedFactoryRuntimeCodeHash: VALID_HASH,
  })

  assert.equal(result.status, 'blocked')
  assert.ok(result.reasons.some(reason => reason.includes('5042')))
})

void test('Mainnet preflight is not verified until approved runtime hashes are supplied', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory', 'legacy'],
    configuredChainId: ARC_MAINNET_CHAIN_ID,
    rpcChainId: ARC_MAINNET_CHAIN_ID,
    vestingAddress: VALID_CORE,
    factoryAddress: VALID_FACTORY,
    vestingCodePresent: true,
    factoryCodePresent: true,
    vestingUsdc: ARC_MAINNET_USDC,
    factoryUsdc: ARC_MAINNET_USDC,
  })

  assert.equal(result.status, 'not-verified')
  assert.ok(result.checks.some(check => check.id === 'factory-runtime' && check.status === 'not-verified'))
})

void test('Mainnet preflight passes only with chain, bytecode, token, and artifact evidence', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory', 'legacy'],
    configuredChainId: ARC_MAINNET_CHAIN_ID,
    rpcChainId: ARC_MAINNET_CHAIN_ID,
    vestingAddress: VALID_CORE,
    factoryAddress: VALID_FACTORY,
    vestingCodePresent: true,
    factoryCodePresent: true,
    vestingUsdc: ARC_MAINNET_USDC,
    factoryUsdc: ARC_MAINNET_USDC,
    expectedFactoryRuntimeCodeHash: VALID_HASH,
    observedFactoryRuntimeCodeHash: VALID_HASH,
    expectedVestingRuntimeCodeHash: VALID_HASH,
    observedVestingRuntimeCodeHash: VALID_HASH,
  })

  assert.equal(result.status, 'ready')
  assert.ok(result.checks.every(check => check.status === 'pass' || check.status === 'not-applicable'))
})

void test('Mainnet preflight rejects factory token and bytecode mismatches', () => {
  const result = evaluateMainnetPreflight({
    releaseComponents: ['factory', 'legacy'],
    configuredChainId: ARC_MAINNET_CHAIN_ID,
    rpcChainId: ARC_MAINNET_CHAIN_ID,
    vestingAddress: VALID_CORE,
    factoryAddress: VALID_FACTORY,
    vestingCodePresent: true,
    factoryCodePresent: true,
    vestingUsdc: ARC_MAINNET_USDC,
    factoryUsdc: '0x3600000000000000000000000000000000000001',
    expectedFactoryRuntimeCodeHash: VALID_HASH,
    observedFactoryRuntimeCodeHash: `0x${'cd'.repeat(32)}`,
    expectedVestingRuntimeCodeHash: VALID_HASH,
    observedVestingRuntimeCodeHash: VALID_HASH,
  })

  assert.equal(result.status, 'blocked')
  assert.ok(result.reasons.some(reason => reason.includes('USDC')))
  assert.ok(result.reasons.some(reason => reason.includes('runtime bytecode')))
})
