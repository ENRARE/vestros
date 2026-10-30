// auth.ts — Wallet-signature auth for GrantHub
import { db } from './db'
import { verifyMessage } from 'viem'
import crypto from 'node:crypto'

const TOKEN_TTL_MS  = 7 * 24 * 60 * 60 * 1000 // 7 days
const NONCE_TTL_MS  = 5 * 60 * 1000             // 5 minutes

export function generateNonce(address: string): { nonce: string; expiresAt: number; message: string } {
  const nonce     = crypto.randomBytes(16).toString('hex')
  const expiresAt = Math.floor((Date.now() + NONCE_TTL_MS) / 1000)
  db.prepare(`INSERT OR REPLACE INTO auth_nonces (nonce, address, expires_at) VALUES (?,?,?)`)
    .run(nonce, address.toLowerCase(), expiresAt)
  return { nonce, expiresAt, message: buildSignMessage(nonce, address, expiresAt) }
}

export function buildSignMessage(nonce: string, address: string, expiresAt: number): string {
  return `Sign in to GrantHub\n\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt * 1000).toISOString()}`
}

export async function verifySignature(
  nonce: string,
  signature: `0x${string}`,
  address: string,
): Promise<boolean> {
  const row = db.prepare<{ address: string; expires_at: number }, string>(
    `SELECT address, expires_at FROM auth_nonces WHERE nonce = ?`,
  ).get(nonce)

  if (!row) return false
  if (row.address !== address.toLowerCase()) return false
  if (row.expires_at < Math.floor(Date.now() / 1000)) return false

  // Single-use nonce
  db.prepare(`DELETE FROM auth_nonces WHERE nonce = ?`).run(nonce)

  const message = buildSignMessage(nonce, address, row.expires_at)
  try {
    return await verifyMessage({ address: address as `0x${string}`, message, signature })
  } catch {
    return false
  }
}

export function issueToken(address: string): string {
  const token     = crypto.randomBytes(32).toString('hex')
  const expiresAt = Math.floor((Date.now() + TOKEN_TTL_MS) / 1000)
  db.prepare(`INSERT INTO auth_tokens (token, address, expires_at) VALUES (?,?,?)`)
    .run(token, address.toLowerCase(), expiresAt)
  return token
}

export function requireAuth(req: Request): { address: string } | null {
  const header = req.headers.get('authorization')
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const now = Math.floor(Date.now() / 1000)
  const row = db.prepare<{ address: string }, [string, number]>(
    `SELECT address FROM auth_tokens WHERE token = ? AND expires_at > ?`,
  ).get(token, now)
  return row ? { address: row.address } : null
}
