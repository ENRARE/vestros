import test from 'node:test'
import assert from 'node:assert/strict'
import { handleArcRpc, resolveArcTestnetRpc } from './arcRpcProxy.ts'

void test('prefers the server-only secondary endpoint over the legacy variable', () => {
  assert.equal(resolveArcTestnetRpc({ ARC_TESTNET_RPC_SECONDARY: 'https://server.example/rpc', VITE_ARC_TESTNET_RPC_SECONDARY: 'https://legacy.example/rpc' }), 'https://server.example/rpc')
  assert.equal(resolveArcTestnetRpc({ VITE_ARC_TESTNET_RPC_SECONDARY: 'https://legacy.example/rpc' }), undefined)
  assert.equal(resolveArcTestnetRpc({}), undefined)
})

void test('returns configuration required without an upstream endpoint', async () => {
  const response = await handleArcRpc(
    new Request('http://localhost/api/rpc/arc-testnet', { method: 'POST', body: '{}' }),
    new URL('http://localhost/api/rpc/arc-testnet'),
    { env: {}, fetchImpl: async () => Response.json({}) },
  )

  assert.equal(response?.status, 503)
})

void test('proxies JSON-RPC without returning the upstream URL', async () => {
  let calledUrl = ''
  const response = await handleArcRpc(
    new Request('http://localhost/api/rpc/arc-testnet', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    }),
    new URL('http://localhost/api/rpc/arc-testnet'),
    {
      env: { ARC_TESTNET_RPC_SECONDARY: 'https://secret.example/rpc/key' },
      fetchImpl: async (input) => {
        calledUrl = String(input)
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x4cef52' })
      },
    },
  )

  assert.equal(response?.status, 200)
  assert.equal(await response?.text(), '{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}')
  assert.equal(calledUrl, 'https://secret.example/rpc/key')
})
