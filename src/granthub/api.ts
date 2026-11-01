/**
 * GrantHub API client — thin fetch wrappers.
 * All money figures are raw USDC (6 dec bigints on chain, numbers here for JSON).
 */
import type { GrantProgram, Organization, GrantApplication, ReviewDecision, GrantAward, Deposit, GrantHubProfile, GrantNotification } from './types'

const BASE = '/api'

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('gh_token')
  const headers = new Headers(opts?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(BASE + path, { ...opts, headers })
  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession()
    window.dispatchEvent(new Event('gh-auth-change'))
  }
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
  if (typeof window !== 'undefined') {
    localStorage.setItem('gh_token', res.token)
    localStorage.setItem('gh_address', res.address)
    window.dispatchEvent(new Event('gh-auth-change'))
  }
  return res
}

export function getStoredSession(): { address: string } | null {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('gh_token')
  const address = localStorage.getItem('gh_address')
  if (!token || !address) return null
  return { address }
}

export function clearSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('gh_token')
  localStorage.removeItem('gh_address')
}

export async function validateSession() {
  return apiFetch<{ address: string }>('/auth/session')
}

export async function getNotifications() {
  return apiFetch<GrantNotification[]>('/notifications')
}

export async function markNotificationRead(id: string) {
  return apiFetch<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'PATCH', body: '{}' })
}

// ── Profile ────────────────────────────────────────────────────────────────
export async function getProfile(address: string) {
  return apiFetch<GrantHubProfile>(`/profiles/${address}`)
}

export async function updateProfile(body: {
  display_name: string
  bio: string
  github: string
  portfolio: string
  skills: string[]
  team: string[]
  public_fields: string[]
}) {
  return apiFetch<{ ok: boolean }>('/profiles', { method: 'PUT', body: JSON.stringify(body) })
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

export async function removeOrgMember(orgId: string, address: string) {
  return apiFetch<{ ok: boolean }>(`/orgs/${orgId}/members/${address}`, { method: 'DELETE' })
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
  criteria_scores?: Record<string, number>; eligibility_checks?: string[]
}) {
  return apiFetch<{ id: string; decision: string }>(`/applications/${appId}/reviews`, {
    method: 'POST', body: JSON.stringify(body),
  })
}

export async function getApplicationHistory(id: string) {
  return apiFetch<Array<{ id: string; actor_addr: string; action: string; note: string | null; created_at: number }>>(`/applications/${id}/history`)
}

// ── Deposits ──────────────────────────────────────────────────────────────────
export async function recordDeposit(grantId: string, body: {
  tx_hash: string; amount_raw?: number; block_number?: number
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
  onchain_award_index: number; pool_contract_address: string; chain_id: number; tx_hash: string
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
