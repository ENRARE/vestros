/**
 * GrantHub API client — thin fetch wrappers.
 * All money figures are raw USDC (6 dec bigints on chain, numbers here for JSON).
 */
import type { GrantProgram, Organization, GrantApplication, ReviewDecision, GrantAward, Deposit } from './types'

const BASE = '/api'

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('gh_token')
  const headers = new Headers(opts?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(BASE + path, { ...opts, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function fetchNonce(address: string) {
  return apiFetch<{ nonce: string; expiresAt: number; message: string }>(`/auth/nonce?address=${address}`)
}

export async function verifyAuth(nonce: string, signature: string, address: string) {
  const res = await apiFetch<{ token: string; address: string }>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ nonce, signature, address }),
  })
  localStorage.setItem('gh_token', res.token)
  localStorage.setItem('gh_address', res.address)
  return res
}

export function getStoredSession(): { address: string } | null {
  const token = localStorage.getItem('gh_token')
  const address = localStorage.getItem('gh_address')
  if (!token || !address) return null
  // Quick expiry check — parse the token payload
  try {
    const [encoded] = token.split('.')
    const payload = JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/'))) as { exp: number }
    if (payload.exp < Math.floor(Date.now() / 1000)) { clearSession(); return null }
  } catch { clearSession(); return null }
  return { address }
}

export function clearSession() {
  localStorage.removeItem('gh_token')
  localStorage.removeItem('gh_address')
}

// ── Grants ────────────────────────────────────────────────────────────────────
export async function listGrants(params?: {
  status?: string; orgId?: string; category?: string; q?: string; sort?: string; page?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.orgId) qs.set('orgId', params.orgId)
  if (params?.category) qs.set('category', params.category)
  if (params?.q) qs.set('q', params.q)
  if (params?.sort) qs.set('sort', params.sort)
  if (params?.page) qs.set('page', String(params.page))
  const q = qs.toString()
  return apiFetch<{ grants: GrantProgram[]; total: number; page: number; pages: number }>(`/grants${q ? `?${q}` : ''}`)
}

export async function getGrant(id: string) {
  return apiFetch<GrantProgram>(`/grants/${id}`)
}

export async function createGrant(orgId: string, body: Partial<GrantProgram>) {
  return apiFetch<GrantProgram>(`/orgs/${orgId}/grants`, { method: 'POST', body: JSON.stringify(body) })
}

export async function updateGrant(id: string, body: Partial<GrantProgram> & { status?: string }) {
  return apiFetch<GrantProgram>(`/grants/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// ── Orgs ──────────────────────────────────────────────────────────────────────
export async function getMyOrgs() {
  return apiFetch<Organization[]>('/orgs')
}

export async function getOrg(id: string) {
  return apiFetch<Organization>(`/orgs/${id}`)
}

export async function createOrg(body: Partial<Organization>) {
  return apiFetch<Organization>('/orgs', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateOrg(id: string, body: Partial<Organization>) {
  return apiFetch<Organization>(`/orgs/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function addOrgMember(orgId: string, address: string, role: string) {
  return apiFetch<{ ok: boolean }>(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify({ address, role }) })
}

// ── Applications ──────────────────────────────────────────────────────────────
export async function getMyApplications() {
  return apiFetch<GrantApplication[]>('/applications/mine')
}

export async function getGrantApplications(grantId: string) {
  return apiFetch<GrantApplication[]>(`/grants/${grantId}/applications`)
}

export async function getApplication(id: string) {
  return apiFetch<GrantApplication>(`/applications/${id}`)
}

export async function submitApplication(grantId: string, body: Partial<GrantApplication> & { submit?: boolean }) {
  return apiFetch<GrantApplication>(`/grants/${grantId}/applications`, { method: 'POST', body: JSON.stringify(body) })
}

export async function updateApplication(id: string, body: Partial<GrantApplication> & { submit?: boolean }) {
  return apiFetch<GrantApplication>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function getApplicationReviews(id: string) {
  return apiFetch<ReviewDecision[]>(`/applications/${id}/reviews`)
}

export async function reviewApplication(appId: string, body: {
  decision: string; score?: number; notes?: string
}) {
  return apiFetch<{ id: string; decision: string }>(`/applications/${appId}/reviews`, {
    method: 'POST', body: JSON.stringify(body),
  })
}

// ── Deposits ──────────────────────────────────────────────────────────────────
export async function recordDeposit(grantId: string, body: {
  tx_hash: string; amount_raw: number; block_number: number; confirmed: boolean
}) {
  return apiFetch<{ id: string }>(`/grants/${grantId}/deposits`, { method: 'POST', body: JSON.stringify(body) })
}

export async function getGrantDeposits(grantId: string) {
  return apiFetch<{ deposits: Deposit[]; confirmed_total: number }>(`/grants/${grantId}/deposits`)
}

// ── Awards ────────────────────────────────────────────────────────────────────
export async function createAward(appId: string, body: Partial<GrantAward>) {
  return apiFetch<{ id: string; status: string }>(`/applications/${appId}/award`, {
    method: 'POST', body: JSON.stringify(body),
  })
}

export async function activateAward(awardId: string, body: {
  contract_address: string; chain_id: number; schedule_id: string; tx_hash: string
}) {
  return apiFetch<{ ok: boolean; status: string }>(`/awards/${awardId}/activate`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

export async function failAward(awardId: string) {
  return apiFetch<{ ok: boolean }>(`/awards/${awardId}/fail`, { method: 'PATCH', body: '{}' })
}

export async function getMyAwards() {
  return apiFetch<GrantAward[]>('/awards/mine')
}

export async function getGrantAwards(grantId: string) {
  return apiFetch<GrantAward[]>(`/grants/${grantId}/awards`)
}
