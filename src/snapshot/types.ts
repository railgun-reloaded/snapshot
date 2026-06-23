type SnapshotBytes = Uint8Array | string

type SnapshotMemoBytes = SnapshotBytes | bigint | readonly number[]
type SnapshotMemo = SnapshotMemoBytes | ReadonlyArray<SnapshotMemoBytes>

type SnapshotAction = {
  actionType: string
  commitments?: Array<{
    memo: SnapshotMemo
  } & Record<string, unknown>>
} & Record<string, unknown>

type SnapshotTransaction = {
  hash: SnapshotBytes
  index: number
  from: SnapshotBytes
  actions: SnapshotAction[][]
}

type SnapshotBlock = {
  number: bigint
  hash: SnapshotBytes
  timestamp: bigint
  transactions: SnapshotTransaction[]
}

type Snapshot = {
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: SnapshotBlock[]
}

export type {
  Snapshot,
  SnapshotAction,
  SnapshotBlock,
  SnapshotBytes,
  SnapshotMemo,
  SnapshotMemoBytes,
  SnapshotTransaction
}
