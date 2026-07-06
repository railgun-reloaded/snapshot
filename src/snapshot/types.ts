type SnapshotBytes = Uint8Array | string

type SnapshotMemoBytes = SnapshotBytes | bigint | readonly number[]
type SnapshotMemo = SnapshotMemoBytes | ReadonlyArray<SnapshotMemoBytes>

/**
 * Commitment payload carried by commitment-bearing snapshot actions.
 *
 * `treeNumber` identifies the Merkle tree and `treePosition` identifies the
 * leaf position within that tree. In artifact order, commitment entries must
 * be unique, strictly ascending by tree number and tree position, and gapless
 * across the represented span. Cold-start artifacts that begin at the
 * deployment block must represent the canonical prefix from tree 0 position 0;
 * later trees may appear only after the previous tree's represented prefix is
 * complete.
 */
type SnapshotCommitment = {
  treeNumber: number
  treePosition: number
  memo?: SnapshotMemo
} & Record<string, unknown>

/**
 * Snapshot action as encoded in the artifact.
 *
 * Action batches and non-commitment actions preserve source transaction/log
 * order. The artifact contract does not require actions to be reordered by
 * action type, nor into unshield, nullifier, or commitment categories.
 */
type SnapshotAction = {
  actionType: string
  commitment?: SnapshotCommitment
  commitments?: SnapshotCommitment[]
} & Record<string, unknown>

/**
 * Snapshot transaction.
 *
 * Transactions within a block are canonicalized and validated as strictly
 * ascending by `index`; duplicate transaction indexes are invalid.
 */
type SnapshotTransaction = {
  hash: SnapshotBytes
  index: number
  from: SnapshotBytes
  actions: SnapshotAction[][]
}

/**
 * Snapshot block.
 *
 * Blocks are canonicalized and validated as strictly ascending by `number`;
 * duplicate block numbers are invalid.
 */
type SnapshotBlock = {
  number: bigint
  hash: SnapshotBytes
  timestamp: bigint
  transactions: SnapshotTransaction[]
}

/**
 * Decoded snapshot artifact.
 *
 * The `blocks` array preserves the canonical artifact sequence: blocks are
 * strictly ascending and unique by block number, transactions are strictly
 * ascending and unique by transaction index within each block, and commitment
 * entries are already valid Merkle insertion order before scanner or wallet
 * consumers receive them.
 */
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
  SnapshotCommitment,
  SnapshotBytes,
  SnapshotMemo,
  SnapshotMemoBytes,
  SnapshotTransaction
}
