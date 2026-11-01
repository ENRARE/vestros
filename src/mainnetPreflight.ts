import { getAddress, isAddress } from 'viem'

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as const

export type MainnetReleaseComponent = 'factory' | 'legacy'

export type MainnetPreflightStatus = 'ready' | 'not-verified' | 'blocked'
export type MainnetPreflightCheckStatus = 'pass' | 'not-verified' | 'blocked' | 'not-applicable'

export interface MainnetPreflightCheck {
  id: string
  label: string
  status: MainnetPreflightCheckStatus
  detail: string
}

export interface MainnetPreflightInput {
  releaseComponents?: readonly MainnetReleaseComponent[]
  configuredChainId?: number
  rpcChainId?: number
  vestingAddress?: string
  factoryAddress?: string
  vestingCodePresent?: boolean
  factoryCodePresent?: boolean
  vestingUsdc?: string
  factoryUsdc?: string
  expectedFactoryRuntimeCodeHash?: string
  observedFactoryRuntimeCodeHash?: string
  expectedVestingRuntimeCodeHash?: string
  observedVestingRuntimeCodeHash?: string
  expectedVestingOwner?: string
  observedVestingOwner?: string
}

export interface MainnetPreflightResult {
  status: MainnetPreflightStatus
  checks: MainnetPreflightCheck[]
  reasons: string[]
}

function sameAddress(left: string | undefined, right: string): boolean {
  return Boolean(left && isAddress(left) && getAddress(left) === getAddress(right))
}

function validHash(value: string | undefined): boolean {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value))
}

function addressCheck(id: string, label: string, value: string | undefined): MainnetPreflightCheck {
  return value && isAddress(value)
    ? { id, label, status: 'pass', detail: 'Configured address is valid.' }
    : { id, label, status: 'blocked', detail: 'No valid Arc Mainnet address is configured.' }
}

function notApplicableCheck(id: string, label: string, detail: string): MainnetPreflightCheck {
  return { id, label, status: 'not-applicable', detail }
}

function bytecodeCheck(
  id: string,
  label: string,
  codePresent: boolean | undefined,
  expectedHash: string | undefined,
  observedHash: string | undefined,
): MainnetPreflightCheck {
  if (codePresent === false) {
    return { id, label, status: 'blocked', detail: 'The configured address has no deployed bytecode.' }
  }
  if (codePresent !== true || !validHash(expectedHash) || !validHash(observedHash)) {
    return { id, label, status: 'not-verified', detail: 'Runtime bytecode evidence and the approved artifact hash are required.' }
  }
  return expectedHash!.toLowerCase() === observedHash!.toLowerCase()
    ? { id, label, status: 'pass', detail: 'Observed runtime bytecode matches the approved public artifact hash.' }
    : { id, label, status: 'blocked', detail: 'Observed runtime bytecode does not match the approved artifact hash.' }
}

export function evaluateMainnetPreflight(input: MainnetPreflightInput): MainnetPreflightResult {
  const checks: MainnetPreflightCheck[] = []
  const requestedComponents = input.releaseComponents ?? []
  const selectedComponents = new Set(requestedComponents)
  const hasInvalidComponent = requestedComponents.some(component => component !== 'factory' && component !== 'legacy')
  const releaseScopeValid = requestedComponents.length > 0 && !hasInvalidComponent && selectedComponents.size > 0
  const includesLegacy = selectedComponents.has('legacy')
  const includesFactory = selectedComponents.has('factory')

  checks.push(releaseScopeValid
    ? { id: 'release-scope', label: 'Approved release scope', status: 'pass', detail: `Validates: ${requestedComponents.join(', ')}.` }
    : { id: 'release-scope', label: 'Approved release scope', status: 'blocked', detail: 'Explicitly select factory, legacy, or both release components.' })

  checks.push(input.configuredChainId === ARC_MAINNET_CHAIN_ID
    ? { id: 'configured-chain', label: 'Configured network', status: 'pass', detail: 'Arc Mainnet (5042) is selected.' }
    : { id: 'configured-chain', label: 'Configured network', status: 'blocked', detail: 'Mainnet preflight requires chain ID 5042; Testnet must never be reused.' })

  checks.push(input.rpcChainId === ARC_MAINNET_CHAIN_ID
    ? { id: 'rpc-chain', label: 'RPC chain', status: 'pass', detail: 'The RPC endpoint reports Arc Mainnet (5042).' }
    : { id: 'rpc-chain', label: 'RPC chain', status: 'blocked', detail: 'The RPC endpoint did not prove chain ID 5042.' })

  checks.push(includesLegacy
    ? addressCheck('core-address', 'Core contract address', input.vestingAddress)
    : notApplicableCheck('core-address', 'Core contract address', 'Legacy USDCVesting is outside the approved release scope.'))
  checks.push(includesFactory
    ? addressCheck('factory-address', 'VestingFactory address', input.factoryAddress)
    : notApplicableCheck('factory-address', 'VestingFactory address', 'Self-service factory is outside the approved release scope.'))
  checks.push(includesLegacy
    ? bytecodeCheck('core-runtime', 'Core runtime bytecode', input.vestingCodePresent, input.expectedVestingRuntimeCodeHash, input.observedVestingRuntimeCodeHash)
    : notApplicableCheck('core-runtime', 'Core runtime bytecode', 'Legacy USDCVesting is outside the approved release scope.'))
  checks.push(includesFactory
    ? bytecodeCheck('factory-runtime', 'Factory runtime bytecode', input.factoryCodePresent, input.expectedFactoryRuntimeCodeHash, input.observedFactoryRuntimeCodeHash)
    : notApplicableCheck('factory-runtime', 'Factory runtime bytecode', 'Self-service factory is outside the approved release scope.'))

  if (!includesFactory) {
    checks.push(notApplicableCheck('factory-usdc', 'Factory USDC', 'Self-service factory is outside the approved release scope.'))
  } else if (!input.factoryUsdc) {
    checks.push({ id: 'factory-usdc', label: 'Factory USDC', status: 'not-verified', detail: 'Factory usdc() has not been read from Mainnet.' })
  } else if (sameAddress(input.factoryUsdc, ARC_MAINNET_USDC)) {
    checks.push({ id: 'factory-usdc', label: 'Factory USDC', status: 'pass', detail: 'Factory points to the canonical Arc USDC address.' })
  } else {
    checks.push({ id: 'factory-usdc', label: 'Factory USDC', status: 'blocked', detail: 'Factory usdc() does not equal the canonical Arc Mainnet USDC address.' })
  }

  if (!includesLegacy) {
    checks.push(notApplicableCheck('core-usdc', 'Core USDC', 'Legacy USDCVesting is outside the approved release scope.'))
  } else if (!input.vestingUsdc) {
    checks.push({ id: 'core-usdc', label: 'Core USDC', status: 'not-verified', detail: 'Core usdc() has not been read from Mainnet.' })
  } else if (sameAddress(input.vestingUsdc, ARC_MAINNET_USDC)) {
    checks.push({ id: 'core-usdc', label: 'Core USDC', status: 'pass', detail: 'Core points to the canonical Arc Mainnet USDC address.' })
  } else {
    checks.push({ id: 'core-usdc', label: 'Core USDC', status: 'blocked', detail: 'Core usdc() does not equal the canonical Arc Mainnet USDC address.' })
  }

  if (!includesLegacy) {
    checks.push(notApplicableCheck('core-owner', 'Core owner', 'Legacy USDCVesting is outside the approved release scope.'))
  } else if (input.expectedVestingOwner || input.observedVestingOwner) {
    checks.push(input.expectedVestingOwner && sameAddress(input.observedVestingOwner, input.expectedVestingOwner)
      ? { id: 'core-owner', label: 'Core owner', status: 'pass', detail: 'Observed owner matches the explicitly configured expected owner.' }
      : { id: 'core-owner', label: 'Core owner', status: 'blocked', detail: 'Observed Core owner does not match the explicitly configured expected owner.' })
  } else {
    checks.push({ id: 'core-owner', label: 'Core owner', status: 'not-applicable', detail: 'No expected Mainnet Core owner is configured.' })
  }

  const reasons = checks
    .filter(check => check.status === 'blocked' || check.status === 'not-verified')
    .map(check => `${check.label}: ${check.detail}`)
  const status: MainnetPreflightStatus = checks.some(check => check.status === 'blocked')
    ? 'blocked'
    : checks.some(check => check.status === 'not-verified')
      ? 'not-verified'
      : 'ready'

  return { status, checks, reasons }
}
