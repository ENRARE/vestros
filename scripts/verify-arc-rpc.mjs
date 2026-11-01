// @ts-check

import { existsSync } from 'node:fs'
import { env, loadEnvFile } from 'node:process'

// oxlint-disable-next-line typescript/no-unsafe-call -- loadEnvFile is a Node host API not resolved by the .mjs type checker.
if (existsSync('.env')) loadEnvFile('.env')

/** @typedef {{ code?: string | number, message?: string }} JsonRpcError */
/** @typedef {{ result?: unknown, error?: JsonRpcError }} JsonRpcResponse */
/** @typedef {[label: string, url: string]} Endpoint */
/** @typedef {{ ok: true, value: unknown } | { ok: false }} OperationResult */

/** @type {Record<string, string | undefined>} */
// oxlint-disable-next-line typescript/no-unsafe-assignment -- node:process is typed as an unresolved host value in this .mjs check script.
const runtimeEnv = env

const CHAIN_ID = 5042002n
const FACTORY = '0xd5e874489038d9fba47f1669980ec885ebae17bf'
const ORIGINAL_VAULT = '0x837c0438f8abf0cd2dcb06636e2781db82d32074'
const SECOND_VAULT = '0x31f4c741a4d3b901b1f0c870e4cf34eeb76aa29c'
const OWNER = '0x0b83a98a46310c47ac6c87c67904b98d6febd392'
const BENEFICIARY = '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58'
const USDC = '0x3600000000000000000000000000000000000000'
const KNOWN_LOG_BLOCK = 69891738n
const VAULT_CREATED_TOPIC = '0x5d9c31ffa0fecffd7cf379989a3c7af252f0335e0d2a1320b55245912c781f53'
const REQUEST_TIMEOUT_MS = 10_000
const LOG_RANGE_STEPS = [1n, 2n, 10n, 100n, 500n, 1_000n, 2_000n, 5_000n, 10_000n]

// Function selectors are explicit so this diagnostic has no ABI/package dependency.
const SELECTOR = {
  vaultCount: '0xa7c6a100',
  vaultOf: '0x0709df45',
  owner: '0x8da5cb5b',
  usdc: '0x3e413bee',
  claimableAmount: '0x6cfe0ad1',
}

/** @type {Endpoint[]} */
const endpoints = [
  ['primary', runtimeEnv.VITE_ARC_TESTNET_RPC || 'https://rpc.testnet.arc.io'],
  ['secondary', runtimeEnv.ARC_TESTNET_RPC_SECONDARY || ''],
]

/** @param {string} value */
function redact(value) {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
    .replace(/(api[-_]?key|token|secret|password)=([^\s&]+)/gi, '$1=<redacted>')
    .slice(0, 240)
}

/** @param {unknown} error */
function errorText(error) {
  return redact(error instanceof Error ? error.message : String(error))
}

/**
 * @param {string} url
 * @param {string} method
 * @param {unknown[]} [params=[]]
 * @returns {Promise<unknown>}
 */
async function rpc(url, method, params = []) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const raw = await response.text()
    /** @type {JsonRpcResponse | undefined} */
    let body
    if (raw !== '') {
      const parsed = /** @type {unknown} */ (JSON.parse(raw))
      if (typeof parsed === 'object' && parsed !== null) {
        body = parsed
      }
    }
    if (!response.ok) {
      const providerError = body?.error
      const detail = providerError
        ? `${providerError.code ?? 'provider'} ${providerError.message ?? 'request rejected'}`
        : 'provider rejected request'
      throw new Error(`HTTP ${response.status}: ${detail}`)
    }
    if (body?.error) throw new Error(`${body.error.code ?? 'RPC'} ${body.error.message ?? 'request failed'}`)
    if (!body || !Object.hasOwn(body, 'result')) throw new Error('RPC response did not include a result')
    return body.result
  } finally {
    clearTimeout(timeout)
  }
}

/** @param {string} url */
function endpointName(url) {
  try { return new URL(url).hostname } catch { return '<invalid-url>' }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | number | bigint | boolean}
 */
function scalar(value, label) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value
  throw new Error(`${label}: expected a scalar RPC result`)
}

/** @param {unknown} value */
function text(value) {
  if (typeof value !== 'string') throw new Error('RPC result was not text')
  return value
}

/** @param {unknown} value */
function list(value) {
  if (!Array.isArray(value)) throw new Error('RPC logs result was not an array')
  return /** @type {unknown[]} */ (value)
}

/** @param {string} selector @param {string} address */
function addressCall(selector, address) {
  return selector + address.slice(2).padStart(64, '0')
}

/** @param {string} selector */
function zeroCall(selector) {
  return selector + '0'.repeat(64)
}

/**
 * @param {string} label
 * @param {string} operation
 * @param {() => Promise<unknown>} action
 * @returns {Promise<OperationResult>}
 */
async function runOperation(label, operation, action) {
  try {
    const value = await action()
    return { ok: true, value }
  } catch (error) {
    console.error(`FAIL ${label} ${operation}: ${errorText(error)}`)
    return { ok: false }
  }
}

/** @param {unknown} value @param {string} expected @param {string} label */
function requireAddress(value, expected, label) {
  const actual = text(value).slice(-40).toLowerCase()
  if (actual !== expected.slice(2).toLowerCase()) throw new Error(`${label}: unexpected returned address`)
}

/**
 * Probe exactly one historical block, then increase only while the provider accepts the request.
 * A larger-range failure is reported as the provider's discovered limit, not as an API-key verdict.
 * @param {string} label
 * @param {string} url
 * @param {bigint} head
 */
async function probeLogRanges(label, url, head) {
  let maxSupported = 0n
  for (const width of LOG_RANGE_STEPS) {
    const fromBlock = head >= width - 1n ? head - width + 1n : 0n
    const result = await runOperation(label, `eth_getLogs[range=${width}]`, async () => list(await rpc(url, 'eth_getLogs', [{
      address: FACTORY,
      topics: [VAULT_CREATED_TOPIC],
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${head.toString(16)}`,
    }])))
    if (!result.ok) {
      console.log(`INFO ${label} eth_getLogs range limit: stopped at ${width} blocks`)
      break
    }
    maxSupported = width
    console.log(`PASS ${label} eth_getLogs[range=${width}]: ${result.value.length} logs`)
  }
  return maxSupported
}

/**
 * @param {string} label
 * @param {string} url
 */
async function verifyEndpoint(label, url) {
  if (!url) {
    console.log(`SKIP ${label}: no endpoint configured`)
    return false
  }

  const host = endpointName(url)
  let requiredFailures = 0
  const chainResult = await runOperation(label, 'eth_chainId', () => rpc(url, 'eth_chainId'))
  if (chainResult.ok) {
    const chainId = BigInt(scalar(chainResult.value, 'eth_chainId'))
    if (chainId === CHAIN_ID) console.log(`PASS ${label} eth_chainId: ${chainId}`)
    else {
      requiredFailures++
      console.error(`FAIL ${label} chain validation: expected ${CHAIN_ID}, got ${chainId}`)
    }
  } else requiredFailures++

  const headResult = await runOperation(label, 'eth_blockNumber', () => rpc(url, 'eth_blockNumber'))
  let head = 0n
  if (headResult.ok) {
    head = BigInt(scalar(headResult.value, 'eth_blockNumber'))
    console.log(`PASS ${label} eth_blockNumber: ${head}`)
  } else requiredFailures++

  const exactBlockTag = `0x${KNOWN_LOG_BLOCK.toString(16)}`
  const exactLogs = await runOperation(label, `eth_getLogs[exact-block=${KNOWN_LOG_BLOCK}]`, async () => list(await rpc(url, 'eth_getLogs', [{
    address: FACTORY,
    topics: [VAULT_CREATED_TOPIC],
    fromBlock: exactBlockTag,
    toBlock: exactBlockTag,
  }])))
  if (exactLogs.ok) console.log(`PASS ${label} eth_getLogs[exact-block=${KNOWN_LOG_BLOCK}]: ${exactLogs.value.length} logs`)
  else requiredFailures++

  const factoryCode = await runOperation(label, 'factory eth_getCode', async () => {
    const code = text(await rpc(url, 'eth_getCode', [FACTORY, 'latest']))
    if (code === '0x') throw new Error('factory has no deployed code')
    return code
  })
  if (factoryCode.ok) console.log(`PASS ${label} factory eth_getCode`)
  else requiredFailures++

  const vaultCode = await runOperation(label, 'vault eth_getCode', async () => {
    const code = text(await rpc(url, 'eth_getCode', [ORIGINAL_VAULT, 'latest']))
    if (code === '0x') throw new Error('vault has no deployed code')
    return code
  })
  if (vaultCode.ok) console.log(`PASS ${label} vault eth_getCode`)
  else requiredFailures++

  const vaultCount = await runOperation(label, 'factory eth_call vaultCount()', async () => {
    const raw = text(await rpc(url, 'eth_call', [{ to: FACTORY, data: SELECTOR.vaultCount }, 'latest']))
    const count = BigInt(raw)
    if (count < 2n) throw new Error(`expected at least 2 registered vaults, got ${count}`)
    return count
  })
  if (vaultCount.ok) console.log(`PASS ${label} factory eth_call vaultCount(): ${String(vaultCount.value)}`)
  else requiredFailures++

  const ownerVault = await runOperation(label, 'factory eth_call vaultOf(owner)', async () => {
    const raw = await rpc(url, 'eth_call', [{ to: FACTORY, data: addressCall(SELECTOR.vaultOf, OWNER) }, 'latest'])
    requireAddress(raw, ORIGINAL_VAULT, 'vaultOf(owner)')
    return raw
  })
  if (ownerVault.ok) console.log(`PASS ${label} factory eth_call vaultOf(owner)`)
  else requiredFailures++

  const beneficiaryVault = await runOperation(label, 'factory eth_call vaultOf(beneficiary)', async () => {
    const raw = await rpc(url, 'eth_call', [{ to: FACTORY, data: addressCall(SELECTOR.vaultOf, BENEFICIARY) }, 'latest'])
    requireAddress(raw, SECOND_VAULT, 'vaultOf(beneficiary)')
    return raw
  })
  if (beneficiaryVault.ok) console.log(`PASS ${label} factory eth_call vaultOf(beneficiary)`)
  else requiredFailures++

  const vaultOwner = await runOperation(label, 'vault eth_call owner()', async () => {
    const raw = await rpc(url, 'eth_call', [{ to: ORIGINAL_VAULT, data: SELECTOR.owner }, 'latest'])
    requireAddress(raw, OWNER, 'vault.owner()')
    return raw
  })
  if (vaultOwner.ok) console.log(`PASS ${label} vault eth_call owner()`)
  else requiredFailures++

  const vaultUsdc = await runOperation(label, 'vault eth_call usdc()', async () => {
    const raw = await rpc(url, 'eth_call', [{ to: ORIGINAL_VAULT, data: SELECTOR.usdc }, 'latest'])
    requireAddress(raw, USDC, 'vault.usdc()')
    return raw
  })
  if (vaultUsdc.ok) console.log(`PASS ${label} vault eth_call usdc()`)
  else requiredFailures++

  const claimable = await runOperation(label, 'vault eth_call claimableAmount(0)', async () => {
    const raw = text(await rpc(url, 'eth_call', [{ to: ORIGINAL_VAULT, data: zeroCall(SELECTOR.claimableAmount) }, 'latest']))
    if (BigInt(raw) !== 0n) throw new Error(`expected schedule 0 claimable amount 0, got ${BigInt(raw)}`)
    return raw
  })
  if (claimable.ok) console.log(`PASS ${label} vault eth_call claimableAmount(0): 0`)
  else requiredFailures++

  if (head > 0n) await probeLogRanges(label, url, head)
  else console.log(`SKIP ${label} eth_getLogs range probe: blockNumber unavailable`)

  console.log(`${requiredFailures === 0 ? 'PASS' : 'FAIL'} ${label} summary: ${host}, requiredFailures=${requiredFailures}`)
  return requiredFailures === 0
}

let failed = false
for (const [label, url] of endpoints) {
  const passed = await verifyEndpoint(label, url)
  if (url && !passed) failed = true
}

if (failed) {
  // oxlint-disable-next-line typescript/no-unsafe-member-access -- process is a Node host global in this .mjs check script.
  process.exitCode = 1
}
