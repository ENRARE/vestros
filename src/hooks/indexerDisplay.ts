export type IndexerDisplayState =
  | { kind: 'hidden' }
  | { kind: 'error' }
  | { kind: 'progress'; progress: number; remaining: bigint }

export function getIndexerDisplayState({
  indexedBlock,
  headBlock,
  error,
}: {
  indexedBlock: bigint
  headBlock: bigint
  error: string | null
}): IndexerDisplayState {
  if (error) return { kind: 'error' }
  if (headBlock <= 0n || indexedBlock >= headBlock) return { kind: 'hidden' }
  if (indexedBlock <= 0n) return { kind: 'hidden' }

  return {
    kind: 'progress',
    progress: Math.max(1, Math.min(99, Math.round(Number((indexedBlock * 100n) / headBlock)))),
    remaining: headBlock - indexedBlock,
  }
}

