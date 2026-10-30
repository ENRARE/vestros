# Vestros — Mainnet-Ready

USDC vesting and grant-funding platform on Arc Testnet. Vestros lets owners create cliff + linear vesting schedules for USDC payments, while GrantHub allows anyone to create grant programs, accept applications, review them, and activate awards that vest automatically through smart contracts.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- React + TypeScript + Vite (frontend)
- Bun + SQLite (API server, `server/`)
- Solidity via Foundry (`contracts/`)
- wagmi v2 + ConnectKit (wallet connection)
- React Router v7 (client-side routing)
- Tailwind CSS v4 (styling, Arc Dark theme)
- Arc Testnet + USDC (chain ID 5042002)

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Foundry](https://getfoundry.sh) (for contract work)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Standard Developer API key (provisioned by Arc Studio) |
| `VITE_USDC_VESTING_CONTRACT` | Deployed USDCVesting contract address on Arc Testnet |
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy auth token (optional outside Arc Studio) |
| `RPC_PROXY_CHAINS` | Comma-separated chain keys for RPC proxy (optional outside Arc Studio) |

### Run

```bash
# Frontend + API server
bun run dev          # Vite frontend on :5173
bun run server/index.ts   # API server on :3001 (proxied at /api)

# Contracts
forge build
forge test
```

### Build

```bash
bun run build
```

## Deployed Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| USDCVesting (active) | `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693` |

GrantPool and GrantVesting contracts are not yet deployed (pending explicit approval).

## Features

- **Vesting Dashboard**: Create, view, and claim USDC vesting schedules onchain. Owner can revoke unvested amounts.
- **GrantHub**: Create grant programs, accept and review applications, activate awards that vest automatically. Any connected wallet can create grants and organizations.
- **Arc Dark UI**: Collapsible sidebar, teal accent (`#2DD4BF`), Space Grotesk / DM Sans typography.
