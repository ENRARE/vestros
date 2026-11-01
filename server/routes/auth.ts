import { generateNonce, buildSignMessage, verifySignature, issueToken, requireAuth } from '../auth'
import { clientIp, limitNonce, limitVerify, tooManyRequests } from '../rate-limit'

export async function handleAuth(req: Request, url: URL): Promise<Response | null> {
  // Validate the opaque bearer token without asking the wallet to sign again.
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Session expired' }, { status: 401 })
    return Response.json({ address: session.address })
  }

  // GET /api/auth/nonce?address=0x...
  if (req.method === 'GET' && url.pathname === '/api/auth/nonce') {
    const ip = clientIp(req)
    const rl = limitNonce(ip)
    if (!rl.allowed) return tooManyRequests(rl.retryAfter)

    const address = url.searchParams.get('address')
    if (!address?.startsWith('0x') || address.length !== 42) {
      return Response.json({ error: 'Invalid address' }, { status: 400 })
    }
    const { nonce, expiresAt } = generateNonce(address)
    const message = buildSignMessage(nonce, address, expiresAt)
    return Response.json({ nonce, expiresAt, message })
  }

  // POST /api/auth/verify
  if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
    const ip = clientIp(req)
    const rl = limitVerify(ip)
    if (!rl.allowed) return tooManyRequests(rl.retryAfter)

    const body = await req.json() as { nonce?: string; signature?: string; address?: string }
    const { nonce, signature, address } = body
    if (!nonce || !signature || !address) {
      return Response.json({ error: 'Missing fields' }, { status: 400 })
    }
    const ok = await verifySignature(nonce, signature as `0x${string}`, address)
    if (!ok) return Response.json({ error: 'Invalid signature' }, { status: 401 })
    const token = issueToken(address)
    return Response.json({ token, address: address.toLowerCase() })
  }

  return null
}
