# Vesting Activity Indexer Operations

The Vestros frontend reads live schedule balances directly from the configured
Arc Testnet vault. Historical activity is indexed by the Bun server into the
existing SQLite database and is served through:

```text
GET /api/vesting/activity?page=1&limit=50&wallet=&organization=&vault=&beneficiary=&scheduleId=
```

For self-service vesting, `organization` is the managing vault-owner wallet;
it filters records by `vault_owner`. The same parameter is intentionally
address-shaped and does not expose a privileged off-chain organization scope.

## Configuration

The worker is Testnet-only and requires chain ID `5042002`:

- `VESTING_INDEXER_ENABLED` enables the background worker.
- `VESTING_INDEXER_POLL_MS` controls the minimum polling interval.
- `VESTING_INDEXER_MAX_BACKFILL_BLOCKS` bounds an individual source's initial backfill.
- `VESTING_INDEXER_OVERLAP_BLOCKS` controls the reorg safety overlap on resumed scans.
- `VESTING_INDEXER_VAULTS_TESTNET` accepts `address@firstSafeBlock@owner@creationTxHash` entries for vaults whose historical start block is known; the transaction hash is optional for backward compatibility.
- `VESTING_INDEXER_CORE_START_BLOCK_TESTNET` and `VESTING_INDEXER_FACTORY_START_BLOCK_TESTNET` can provide verified deployment blocks directly.

The worker resolves deployment blocks from configured deployment transaction
hashes when explicit start blocks are absent. It never starts at blockchain
genesis. `ARC_TESTNET_RPC_SECONDARY` is server-only; the browser uses the
same-origin RPC proxy and never receives the authenticated provider URL.

When a factory source is configured, the worker also indexes its verified
`VaultCreated` events using the factory checkpoint. A newly discovered vault
inherits the event's block and creation transaction as its historical start,
then receives its own vault checkpoint. This avoids manual configuration for
future factory-created vaults while keeping discovery bounded by the normal
backfill limit.

## Bounded retrieval and failover

The indexer uses the existing primary Arc RPC plus the configured secondary
provider through a bounded viem fallback transport. Log batches start at
2,000 blocks and shrink after provider errors until they reach the secondary
provider's supported 10-block range. Successful batches grow back gradually.
Each request has bounded retries and exponential backoff. A failed batch does
not advance its checkpoint, and a later run resumes from the last persisted
checkpoint rather than restarting the source.

## Persistence and reorg handling

Migration v6 creates three additive tables:

- `vesting_index_sources` stores source checkpoints and coverage status.
- `vesting_vaults` stores discovered vault ownership separately from events.
- `vesting_events` stores verified decoded events.

Event identity is `(chainId, vaultAddress, txHash, logIndex)`. Schedule
identity is `(chainId, vaultAddress, scheduleId)`, so equal schedule IDs in
different vaults remain independent. Resumed scans overlap the configured
reorg window; events in that window are replaced transactionally before the
new records are inserted.

## Coverage states

The API returns `coverage` as:

- `complete`: all configured sources reached their current head.
- `partial`: at least one source is still backfilling or lacks a safe start block.
- `unavailable`: no usable index source is available.

The frontend keeps direct schedule reads visible for partial or unavailable
history. It does not show block percentages or remaining-block counters, and it
does not label an unchecked history as empty.

## Fixture verification

The first Arc Testnet schedule is a test fixture only. Its creation and claim
transactions are recovered from decoded logs and persisted by the worker; the
hashes are not production UI constants. Use the read-only RPC verifier and the
server activity endpoint to confirm the records after a fresh index run.

Do not run deployment, approval, claim, funding, ownership, or GrantHub
financial transactions as part of indexer operations.

