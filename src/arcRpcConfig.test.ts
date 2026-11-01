import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveArcRpcUrls } from './arcRpcConfig.ts'

const ARC_TESTNET_ID = 5042002
const ARC_MAINNET_ID = 5042

void test('uses the public Arc Testnet endpoint without requiring the server proxy', () => {
  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID), [
    'https://rpc.testnet.arc.io',
  ])
})

void test('does not expose an authenticated Arc Testnet secondary in browser configuration', () => {
  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID, {
    VITE_ARC_TESTNET_RPC: 'https://primary.example/rpc',
    VITE_ARC_TESTNET_RPC_SECONDARY: 'https://alchemy.example/rpc',
    VITE_ARC_TESTNET_RPC_FALLBACK: 'https://public-fallback.example/rpc',
    VITE_ARC_MAINNET_RPC: 'https://mainnet.example/rpc',
    VITE_ARC_MAINNET_RPC_SECONDARY: 'https://mainnet-secondary.example/rpc',
  }), [
    'https://primary.example/rpc',
    'https://public-fallback.example/rpc',
  ])
})

void test('does not use Testnet endpoints for Mainnet or blank secondary configuration', () => {
  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID, {
    VITE_ARC_TESTNET_RPC: 'https://primary.example/rpc',
    VITE_ARC_TESTNET_RPC_SECONDARY: '',
  }), ['https://primary.example/rpc'])

  assert.deepEqual(resolveArcRpcUrls(ARC_MAINNET_ID, {
    VITE_ARC_TESTNET_RPC: 'https://testnet.example/rpc',
    VITE_ARC_TESTNET_RPC_SECONDARY: 'https://testnet-secondary.example/rpc',
    VITE_ARC_MAINNET_RPC: 'https://mainnet.example/rpc',
    VITE_ARC_MAINNET_RPC_SECONDARY: '',
    VITE_ARC_MAINNET_RPC_FALLBACK: '',
  }), ['https://mainnet.example/rpc'])

  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID, {
    VITE_ARC_TESTNET_RPC: '',
    VITE_ARC_TESTNET_RPC_SECONDARY: 'https://alchemy.example/rpc',
  }), ['https://rpc.testnet.arc.io'])
})

void test('removes duplicate and invalid endpoint values without inventing a fallback', () => {
  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID, {
    VITE_ARC_TESTNET_RPC: 'not-a-url',
    VITE_ARC_TESTNET_RPC_SECONDARY: 'https://rpc.testnet.arc.io',
  }), ['https://rpc.testnet.arc.io'])
})

void test('rejects browser URLs carrying credentials or query-string API keys', () => {
  assert.deepEqual(resolveArcRpcUrls(ARC_TESTNET_ID, {
    VITE_ARC_TESTNET_RPC: 'https://user:secret@primary.example/rpc',
    VITE_ARC_TESTNET_RPC_FALLBACK: 'https://public.example/rpc?key=secret',
  }), ['https://rpc.testnet.arc.io'])
})
