import assert from 'node:assert/strict'
import test from 'node:test'
import { isFactoryConfigured, resolveVestingFactoryAddress } from './vestingFactoryAddress.ts'

void test('uses only the active network factory address', () => {
  const testnet = resolveVestingFactoryAddress('testnet', {
    VITE_VESTING_FACTORY_TESTNET: '0x1111111111111111111111111111111111111111',
    VITE_VESTING_FACTORY_MAINNET: '0x2222222222222222222222222222222222222222',
  })
  const mainnet = resolveVestingFactoryAddress('mainnet', {
    VITE_VESTING_FACTORY_TESTNET: '0x1111111111111111111111111111111111111111',
    VITE_VESTING_FACTORY_MAINNET: undefined,
  })

  assert.equal(testnet, '0x1111111111111111111111111111111111111111')
  assert.equal(mainnet, undefined)
})

void test('treats invalid and blank factory addresses as undeployed', () => {
  assert.equal(resolveVestingFactoryAddress('testnet', { VITE_VESTING_FACTORY_TESTNET: '' }), undefined)
  assert.equal(resolveVestingFactoryAddress('testnet', { VITE_VESTING_FACTORY_TESTNET: 'not-an-address' }), undefined)
  assert.equal(isFactoryConfigured(undefined), false)
  assert.equal(isFactoryConfigured('0x3333333333333333333333333333333333333333'), true)
})
