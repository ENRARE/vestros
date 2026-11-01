# Vestros — Mainnet-Ready

USDC vesting and grant-funding platform on Arc. Vestros lets owners create cliff + linear vesting schedules for USDC payments. GrantHub adds organizations, grant discovery, applications, reviews, and an audited-but-disabled-by-default funding path backed by GrantPool and GrantVesting.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- React + TypeScript + Vite (frontend)
- Bun + SQLite (optional API server and persistent indexer, `server/`)
- Solidity via Foundry (`contracts/`)
- wagmi v2 + ConnectKit (wallet connection)
- React Router v7 (client-side routing)
- Tailwind CSS v4 (styling, Arc Dark theme)
- Arc Testnet (5042002) and Arc Mainnet (5042)

## Development

### Prerequisites

- Node.js/npm or [Bun](https://bun.sh) >= 1.0 for frontend development
- Bun >= 1.0 only when running the optional API server, SQLite indexer, or GrantHub backend
- [Foundry](https://getfoundry.sh) (for contract work)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Standard Developer API key (provisioned by Arc Studio) |
| `VITE_CHAIN_ENV` | `testnet` (default) or `mainnet`; selects the active Arc network |
| `VITE_USDC_VESTING_CONTRACT_TESTNET` | USDCVesting address on Arc Testnet |
| `VITE_USDC_VESTING_CONTRACT_MAINNET` | USDCVesting address on Arc Mainnet; leave unset until deployed and verified |
| `VITE_USDC_VESTING_DEPLOY_TX_TESTNET` / `_MAINNET` | Deployment transaction used by the event indexer for the selected network |
| `VITE_GRANTHUB_FINANCIAL` | Frontend financial-feature flag; default `false` |
| `GRANTHUB_FINANCIAL_ENABLED` | Server authorization flag; default `false`, and must be explicitly enabled only after review |
| `VITE_ARC_TESTNET_RPC` / `VITE_ARC_MAINNET_RPC` | Browser-safe public RPC endpoints for the selected Arc network |
| `VITE_ARC_TESTNET_RPC_FALLBACK` / `VITE_ARC_MAINNET_RPC_FALLBACK` | Optional browser-safe public HTTPS fallbacks; never include API keys |
| `ARC_TESTNET_RPC_SECONDARY` | Server-only authenticated/provider fallback; never expose this as `VITE_*` |
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy auth token (optional outside Arc Studio) |
| `RPC_PROXY_CHAINS` | Comma-separated chain keys for RPC proxy (optional outside Arc Studio) |

Copy `.env.example` to `.env`; never commit secrets. `PRIVATE_KEY` is supported for testnet Foundry scripts only. Mainnet scripts reject it and require `--ledger` or an encrypted `--account` keystore.

### Run

```bash
# Frontend-only Core
npm run dev          # Vite frontend on :5173; Core uses direct wallet/RPC reads

# Optional API server, persistent indexer, and GrantHub backend
bun run server/index.ts   # API server on :3001 (proxied at /api)

# Contracts
forge build
forge test
npm run typecheck
npm run test:server
npm run build
```

### Build

```bash
bun run build
```

## Deployed Contracts (Arc Testnet / Mainnet)

| Network | Contract | Address | Explorer |
|---|---|---|---|
| Arc Testnet | USDCVesting (active) | `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693` | [Explorer](https://explorer.testnet.arc.io/address/0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693) |
| Arc Mainnet | USDCVesting | Not deployed | — |

The Arc ERC-20 USDC address is `0x3600000000000000000000000000000000000000` on both networks and uses 6 decimals. Arc's native gas token is also USDC, but uses 18 decimals. The first Arc Testnet GrantPool and GrantVesting deployment is recorded in [the Testnet deployment runbook](docs/granthub-testnet-deployment.md); ownership transfer, funding, and the financial rehearsal remain separately gated.

Vestros Core can read and write vesting contracts with the Bun server stopped. The browser records only confirmed receipts observed in that browser; older owner-wide history may be partial because deployed vesting contracts do not enumerate every owner schedule. The optional Activity API can enhance that history when available. GrantHub application, review, organization, and database-backed features still require the Bun server and SQLite database. GrantHub financial routes (`deposits`, deposit confirmation, and award activation) return HTTP 503 unless the server flag is explicitly enabled. The UI displays the disabled-state banner while the frontend flag is off.

For deployment procedures, signing restrictions, and the post-deploy checklist, see [docs/mainnet-readiness.md](docs/mainnet-readiness.md), [docs/go-no-go.md](docs/go-no-go.md), and the [controlled GrantHub Testnet rehearsal](docs/granthub-testnet-rehearsal.md).

## Features

- **Vesting Dashboard**: Create, view, and claim USDC vesting schedules onchain. Owner can revoke unvested amounts.
- **GrantHub**: Create grant programs, accept and review applications, activate awards that vest automatically. Any connected wallet can create grants and organizations.
- **Arc Dark UI**: Collapsible sidebar, teal accent (`#2DD4BF`), Space Grotesk / DM Sans typography.
