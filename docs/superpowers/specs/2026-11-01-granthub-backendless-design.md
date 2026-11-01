# Backendless GrantHub Design Note

This is a future design only. It is not implemented by the Frontend-First
Vestros Core release.

## Objective

Allow GrantHub organizations, applications, reviews, member administration,
notifications, and complete activity to operate without a self-hosted Bun
server while preserving authorization and auditability.

## Required architecture

- Organization, membership, grant, application, review, award, and notification
  state would need immutable onchain or signed state transitions with explicit
  role checks; the existing SQLite REST API cannot be replaced by localStorage.
- A managed indexing layer would materialize verified contract events into a
  queryable API or decentralized storage. It must support chain, organization,
  wallet, grant, application, and award identity, reorg recovery, pagination,
  and access control.
- Wallet signatures would authorize user actions, while organization roles
  would need an onchain or independently verifiable membership authority.
- Private operational data would require encrypted client-side or managed
  storage with a documented key-recovery model.
- Financial deposits and award activation would remain disabled until contracts,
  role authority, replay protection, and recovery procedures receive a separate
  security review.

## Migration boundary

The existing Bun backend, SQLite database, migrations, REST routes, and GrantHub
frontend remain the production path until this design is separately specified,
implemented, audited, and rehearsed. The Frontend-First Core release must never
pretend that GrantHub is backendless.
