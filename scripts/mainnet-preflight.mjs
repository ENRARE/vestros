// @ts-check
/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-argument, typescript/no-unsafe-return, typescript/no-unsafe-call, typescript/no-unsafe-member-access */

import { existsSync } from 'node:fs'
import { env, loadEnvFile } from 'node:process'
import { keccak256 } from 'viem'

// This script performs read-only JSON-RPC calls only. It never loads PRIVATE_KEY
// and never sends a transaction.
// oxlint-disable-next-line typescript/no-unsafe-call -- Node host API.
if (existsSync('.env')) loadEnvFile('.env')

const CHAIN_ID = 5042n
const USDC = '0x3600000000000000000000000000000000000000'
const RPC = env.VITE_ARC_MAINNET_RPC || 'https://rpc.mainnet.arc.io'
const RELEASE_COMPONENTS = (env.MAINNET_RELEASE_COMPONENTS || '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean)
const VALID_RELEASE_COMPONENTS = new Set(['factory', 'legacy'])
const RELEASE_SCOPE_VALID = RELEASE_COMPONENTS.length > 0 &&
  RELEASE_COMPONENTS.every(component => VALID_RELEASE_COMPONENTS.has(component))
const NEEDS_FACTORY = RELEASE_COMPONENTS.includes('factory')
const NEEDS_LEGACY = RELEASE_COMPONENTS.includes('legacy')
const CORE = NEEDS_LEGACY ? env.VITE_USDC_VESTING_CONTRACT_MAINNET || '' : ''
const FACTORY = NEEDS_FACTORY ? env.VITE_VESTING_FACTORY_MAINNET || '' : ''
const EXPECTED_CORE_HASH = NEEDS_LEGACY ? env.VITE_MAINNET_USDC_VESTING_RUNTIME_CODE_HASH || '' : ''
const EXPECTED_FACTORY_HASH = NEEDS_FACTORY ? env.VITE_MAINNET_VESTING_FACTORY_RUNTIME_CODE_HASH || '' : ''
const REQUEST_TIMEOUT_MS = 10_000

const SELECTOR = {
  owner: '0x8da5cb5b',
  usdc: '0x3e413bee',
}

function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
    .replace(/(api[-_]?key|token|secret|password)=([^\s&]+)/gi, '$1=<redacted>')
    .slice(0, 240)
}

function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not a valid address`)
  return value.toLowerCase()
}

function hash(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not a valid runtime code hash`)
  return value.toLowerCase()
}

async function rpc(method, params = []) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body?.error?.message || 'provider rejected request'}`)
    }
    if (body?.error) throw new Error(`${body.error.code || 'RPC'} ${body.error.message || 'request failed'}`)
    return body?.result
  } finally {
    clearTimeout(timeout)
  }
}

function requireResult(value, label) {
  if (value === undefined || value === null) throw new Error(`${label} returned no result`)
  return value
}

function requireAddressResult(value, expected, label) {
  const actual = String(value).slice(-40).toLowerCase()
  if (actual !== expected.slice(2).toLowerCase()) throw new Error(`${label} returned ${actual}`)
}

function report(label, status, detail) {
  console.log(`${status} ${label}: ${detail}`)
}

let failed = false
let notVerified = false

try {
  if (!RELEASE_SCOPE_VALID) {
    report('release scope', 'BLOCKED', 'Set MAINNET_RELEASE_COMPONENTS to factory, legacy, or factory,legacy; no Mainnet interaction is enabled.')
    process.exitCode = 2
  } else {
    const chain = BigInt(requireResult(await rpc('eth_chainId'), 'eth_chainId'))
    if (chain !== CHAIN_ID) throw new Error(`expected chain ID ${CHAIN_ID}, got ${chain}`)
    report('eth_chainId', 'PASS', String(chain))

    const block = requireResult(await rpc('eth_blockNumber'), 'eth_blockNumber')
    report('eth_blockNumber', 'PASS', String(BigInt(block)))

    if ((NEEDS_LEGACY && !CORE) || (NEEDS_FACTORY && !FACTORY)) {
      throw new Error(`Missing address for approved release scope (${RELEASE_COMPONENTS.join(', ')}). Configure only the selected Mainnet component addresses.`)
    }

    const core = NEEDS_LEGACY ? address(CORE, 'VITE_USDC_VESTING_CONTRACT_MAINNET') : ''
    const factory = NEEDS_FACTORY ? address(FACTORY, 'VITE_VESTING_FACTORY_MAINNET') : ''
    const coreCode = NEEDS_LEGACY ? await rpc('eth_getCode', [core, 'latest']) : ''
    const factoryCode = NEEDS_FACTORY ? await rpc('eth_getCode', [factory, 'latest']) : ''

    if ((NEEDS_LEGACY && coreCode === '0x') || (NEEDS_FACTORY && factoryCode === '0x')) {
      throw new Error('A configured Mainnet release component has no deployed bytecode')
    }
    report('contract bytecode', 'PASS', RELEASE_COMPONENTS.join(' + '))

    const observedFactoryHash = NEEDS_FACTORY ? keccak256(factoryCode) : ''
    const observedCoreHash = NEEDS_LEGACY ? keccak256(coreCode) : ''
    const missingApprovedHash = (NEEDS_FACTORY && !EXPECTED_FACTORY_HASH) || (NEEDS_LEGACY && !EXPECTED_CORE_HASH)
    if (missingApprovedHash) {
      notVerified = true
      report('approved runtime artifacts', 'NOT VERIFIED', 'Set public runtime code hashes for every selected component after independent artifact review')
    } else {
      if (NEEDS_FACTORY && hash(EXPECTED_FACTORY_HASH, 'VITE_MAINNET_VESTING_FACTORY_RUNTIME_CODE_HASH') !== observedFactoryHash.toLowerCase()) {
        throw new Error(`factory runtime hash mismatch: observed ${observedFactoryHash}`)
      }
      if (NEEDS_LEGACY && hash(EXPECTED_CORE_HASH, 'VITE_MAINNET_USDC_VESTING_RUNTIME_CODE_HASH') !== observedCoreHash.toLowerCase()) {
        throw new Error(`Core runtime hash mismatch: observed ${observedCoreHash}`)
      }
      report('approved runtime artifacts', 'PASS', 'Observed runtime code matches configured public hashes')
    }

    if (NEEDS_FACTORY) {
      const factoryUsdc = requireResult(await rpc('eth_call', [{ to: factory, data: SELECTOR.usdc }, 'latest']), 'factory usdc()')
      requireAddressResult(factoryUsdc, USDC, 'factory usdc()')
      report('factory usdc()', 'PASS', USDC)
    }

    if (NEEDS_LEGACY) {
      const coreUsdc = requireResult(await rpc('eth_call', [{ to: core, data: SELECTOR.usdc }, 'latest']), 'Core usdc()')
      requireAddressResult(coreUsdc, USDC, 'Core usdc()')
      report('Core usdc()', 'PASS', USDC)

      const coreOwner = requireResult(await rpc('eth_call', [{ to: core, data: SELECTOR.owner }, 'latest']), 'Core owner()')
      report('Core owner()', 'PASS', `0x${String(coreOwner).slice(-40)}`)
    }
  }
} catch (error) {
  failed = true
  report('preflight', 'FAIL', redact(error instanceof Error ? error.message : error))
}

if (failed) process.exitCode = 1
else if (notVerified && process.exitCode === undefined) process.exitCode = 2
