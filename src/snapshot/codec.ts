import type { EVMBlock } from '@railgun-reloaded/scanner'

import { getNetworkConfigFromChainID } from '../config/index.js'
import { artifactCIDFromBytes } from '../lib/content/artifact.js'
import { CID } from '../lib/formats/multiformats.js'

import { DAGCBORCodec } from './dagcbor-codec.js'
import type {
  Snapshot,
  SnapshotAction,
  SnapshotBlock,
  SnapshotBytes,
  SnapshotCommitment,
  SnapshotMemo,
  SnapshotMemoCommitment,
  SnapshotTransaction
} from './types.js'

const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024
const BROTLI_QUALITY = 6
const SNAPSHOT_VERSION = 1
const TREE_MAX_ITEMS = 65536

/**
 * Chain and block-range metadata for the snapshot encoder.
 */
type EncodeSnapshotMetadata = {
  chainID: number
  startHeight: bigint
  endHeight: bigint
}

type SnapshotCommitmentPosition = Pick<
  SnapshotCommitment,
  'treeNumber' | 'treePosition'
>

type EncodeSnapshotBlock = EVMBlock | SnapshotBlock

/**
 * Normalize a decoded height.
 * @param value - Decoded value.
 * @param fieldName - Field name for errors.
 * @returns Bigint height.
 */
function normalizeHeight (value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value)
  }
  throw new Error(`Invalid snapshot: missing or invalid ${fieldName}`)
}

/**
 * Require an object record.
 * @param value - Candidate value.
 * @param fieldName - Field name for errors.
 * @returns Object record.
 */
function requireRecord (
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid snapshot: ${fieldName} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Require a safe integer.
 * @param value - Candidate value.
 * @param fieldName - Field name for errors.
 * @returns Integer value.
 */
function requireInteger (value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid snapshot: missing or invalid ${fieldName}`)
  }
  return value
}

/**
 * Require snapshot bytes.
 * @param value - Candidate value.
 * @param fieldName - Field name for errors.
 * @returns Snapshot byte representation.
 */
function requireBytes (value: unknown, fieldName: string): SnapshotBytes {
  if (!(value instanceof Uint8Array) && typeof value !== 'string') {
    throw new Error(`Invalid snapshot: missing or invalid ${fieldName}`)
  }
  return value
}

/**
 * Check whether a value is one memo byte entry.
 * @param value - Candidate value.
 * @returns Whether the value is memo bytes.
 */
function isMemoBytes (value: unknown): boolean {
  return typeof value === 'string' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array ||
    (Array.isArray(value) && value.every(
      entry => typeof entry === 'number' && Number.isInteger(entry)
    ))
}

/**
 * Check whether a value is a supported memo payload.
 * @param value - Candidate value.
 * @returns Whether the value is a memo payload.
 */
function isMemo (value: unknown): value is SnapshotMemo {
  return isMemoBytes(value) ||
    (Array.isArray(value) && value.every(isMemoBytes))
}

/**
 * Return the configured deployment block for a supported chain.
 * @param chainID - EVM chain ID.
 * @returns Deployment block.
 */
function getDeploymentBlock (chainID: number): bigint {
  try {
    return getNetworkConfigFromChainID(chainID).deploymentBlock
  } catch (err) {
    throw new Error(`Invalid snapshot: unknown chainID ${chainID}`, {
      cause: err
    })
  }
}

/**
 * Validate one commitment payload's Merkle position.
 * @param commitment - Commitment record.
 * @param fieldName - Field name for errors.
 * @returns Normalized position pair.
 */
function validateCommitmentPosition (
  commitment: Record<string, unknown>,
  fieldName: string
): Pick<SnapshotCommitment, 'treeNumber' | 'treePosition'> {
  const treeNumber = requireInteger(
    commitment['treeNumber'],
    `${fieldName} treeNumber`
  )
  if (treeNumber < 0) {
    throw new Error('Invalid snapshot: commitment treeNumber cannot be negative')
  }

  const treePosition = requireInteger(
    commitment['treePosition'],
    `${fieldName} treePosition`
  )
  if (treePosition < 0 || treePosition >= TREE_MAX_ITEMS) {
    throw new Error(
      `Invalid snapshot: commitment treePosition must be between 0 and ${TREE_MAX_ITEMS - 1}`
    )
  }

  return { treeNumber, treePosition }
}

function validateCommitment (
  value: unknown,
  requireMemo: true
): SnapshotMemoCommitment
function validateCommitment (
  value: unknown,
  requireMemo: false
): SnapshotCommitment
/**
 * Validate one decoded commitment payload.
 * @param value - Decoded commitment.
 * @param requireMemo - Whether this commitment shape requires a memo payload.
 * @returns Snapshot commitment.
 */
function validateCommitment (
  value: unknown,
  requireMemo: boolean
): SnapshotCommitment {
  const commitment = requireRecord(value, 'commitment')
  const { treeNumber, treePosition } = validateCommitmentPosition(
    commitment,
    'commitment'
  )

  const validated: SnapshotCommitment = {
    ...commitment,
    treeNumber,
    treePosition
  }

  if (requireMemo) {
    const memo = commitment['memo']
    if (!isMemo(memo)) {
      throw new Error('Invalid snapshot: commitment memo has invalid bytes')
    }
    return {
      ...validated,
      memo
    }
  }

  if (commitment['memo'] !== undefined) {
    const memo = commitment['memo']
    if (!isMemo(memo)) {
      throw new Error('Invalid snapshot: commitment memo has invalid bytes')
    }
    validated.memo = memo
  }

  return validated
}

function canonicalizeCommitmentForEncode (value: unknown): SnapshotCommitment
function canonicalizeCommitmentForEncode (
  value: unknown,
  requireMemo: true
): SnapshotMemoCommitment
function canonicalizeCommitmentForEncode (
  value: unknown,
  requireMemo: false
): SnapshotCommitment
/**
 * Normalize scanner commitment positions for producer-side encoding.
 * Snapshot artifacts store the leaf position inside the represented tree, but
 * scanner RPC formatting can expose the global insertion position.
 * @param value - Candidate commitment.
 * @param requireMemo - Whether this commitment shape requires a memo payload.
 * @returns Snapshot commitment with per-tree position.
 */
function canonicalizeCommitmentForEncode (
  value: unknown,
  requireMemo = false
): SnapshotCommitment {
  const commitment = requireRecord(value, 'commitment')
  const treeNumber = requireInteger(
    commitment['treeNumber'],
    'commitment treeNumber'
  )
  const treePosition = requireInteger(
    commitment['treePosition'],
    'commitment treePosition'
  )

  if (treeNumber < 0) {
    throw new Error('Invalid snapshot: commitment treeNumber cannot be negative')
  }

  let normalizedTreePosition = treePosition
  if (treePosition >= TREE_MAX_ITEMS) {
    if (Math.floor(treePosition / TREE_MAX_ITEMS) === treeNumber) {
      normalizedTreePosition = treePosition % TREE_MAX_ITEMS
    }
  }

  const canonicalized: SnapshotCommitment = {
    ...commitment,
    treeNumber,
    treePosition: normalizedTreePosition
  }

  if (requireMemo) {
    const memo = commitment['memo']
    if (!isMemo(memo)) {
      throw new Error('Invalid snapshot: commitment memo has invalid bytes')
    }
    return {
      ...canonicalized,
      memo
    }
  }

  if (commitment['memo'] !== undefined) {
    const memo = commitment['memo']
    if (!isMemo(memo)) {
      throw new Error('Invalid snapshot: commitment memo has invalid bytes')
    }
    canonicalized.memo = memo
  }

  return canonicalized
}

/**
 * Normalize one action for producer-side encoding while preserving extra fields.
 * @param value - Candidate action.
 * @returns Snapshot action.
 */
function canonicalizeActionForEncode (value: unknown): SnapshotAction {
  const action = requireRecord(value, 'action')
  if (
    typeof action['actionType'] !== 'string' ||
    action['actionType'].length === 0
  ) {
    throw new Error('Invalid snapshot: missing or invalid actionType')
  }

  const canonicalized: SnapshotAction = {
    ...action,
    actionType: action['actionType']
  }

  if (action['commitment'] !== undefined) {
    canonicalized.commitment = canonicalizeCommitmentForEncode(
      action['commitment']
    )
  }

  if (action['commitments'] !== undefined) {
    if (!Array.isArray(action['commitments'])) {
      throw new Error('Invalid snapshot: commitments must be an array')
    }
    canonicalized.commitments = action['commitments'].map(value =>
      canonicalizeCommitmentForEncode(value, true)
    )
  }

  return canonicalized
}

/**
 * Normalize action batches for producer-side encoding.
 * @param value - Candidate action batches.
 * @returns Snapshot action batches.
 */
function canonicalizeActionBatchesForEncode (
  value: unknown
): SnapshotAction[][] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid snapshot: transaction actions must be an array')
  }

  return value.map((batch) => {
    if (!Array.isArray(batch)) {
      throw new Error('Invalid snapshot: transaction action batch must be an array')
    }
    return batch.map(canonicalizeActionForEncode)
  })
}

/**
 * Validate one decoded action.
 * @param value - Decoded action.
 * @returns Snapshot action.
 */
function validateAction (value: unknown): SnapshotAction {
  const action = requireRecord(value, 'action')
  if (
    typeof action['actionType'] !== 'string' ||
    action['actionType'].length === 0
  ) {
    throw new Error('Invalid snapshot: missing or invalid actionType')
  }

  const validated: SnapshotAction = {
    ...action,
    actionType: action['actionType']
  }

  if (action['commitment'] !== undefined) {
    validated.commitment = validateCommitment(action['commitment'], false)
  }

  if (action['commitments'] !== undefined) {
    if (!Array.isArray(action['commitments'])) {
      throw new Error('Invalid snapshot: commitments must be an array')
    }
    validated.commitments = action['commitments'].map(
      value => validateCommitment(value, true)
    )
  }

  return validated
}

/**
 * Validate one decoded transaction.
 * @param value - Decoded transaction.
 * @returns Snapshot transaction.
 */
function validateTransaction (value: unknown): SnapshotTransaction {
  const transaction = requireRecord(value, 'transaction')
  if (
    transaction['actions'] !== undefined &&
    !Array.isArray(transaction['actions'])
  ) {
    throw new Error('Invalid snapshot: transaction actions must be an array')
  }

  const rawActions = Array.isArray(transaction['actions'])
    ? transaction['actions']
    : []
  const actions = rawActions.map((batch) => {
    if (!Array.isArray(batch)) {
      throw new Error('Invalid snapshot: transaction action batch must be an array')
    }
    return batch.map(validateAction)
  })

  return {
    hash: requireBytes(transaction['hash'], 'transaction hash'),
    index: requireInteger(transaction['index'], 'transaction index'),
    from: requireBytes(transaction['from'], 'transaction from'),
    actions
  }
}

/**
 * Validate one decoded block.
 * @param value - Decoded block.
 * @returns Snapshot block.
 */
function validateBlock (value: unknown): SnapshotBlock {
  const block = requireRecord(value, 'block')
  if (!Array.isArray(block['transactions'])) {
    throw new Error('Invalid snapshot: block transactions must be an array')
  }

  return {
    number: normalizeHeight(block['number'], 'block number'),
    hash: requireBytes(block['hash'], 'block hash'),
    timestamp: normalizeHeight(block['timestamp'], 'block timestamp'),
    transactions: block['transactions'].map(validateTransaction)
  }
}

/**
 * Track strictly-ascending, unique keys across a sequence, throwing a
 * caller-described error on the first duplicate or out-of-order key.
 * @param key - Current item's ordering key.
 * @param previous - Previous item's ordering key, if any.
 * @param describe - Builds the error message for a duplicate or descending key.
 * @returns The key to pass as `previous` for the next item.
 */
function assertAscendingKey<T extends bigint | number> (
  key: T,
  previous: T | undefined,
  describe: (kind: 'duplicate' | 'descending') => string
): T {
  if (previous !== undefined) {
    if (key === previous) {
      throw new Error(`Invalid snapshot: ${describe('duplicate')}`)
    }
    if (key < previous) {
      throw new Error(`Invalid snapshot: ${describe('descending')}`)
    }
  }
  return key
}

/**
 * Validate canonical block number and transaction index ordering.
 * @param blocks - Decoded blocks.
 * @param startHeight - Inclusive start height.
 * @param endHeight - Inclusive end height.
 */
function validateBlockAndTransactionOrdering (
  blocks: SnapshotBlock[],
  startHeight: bigint,
  endHeight: bigint
): void {
  let previousBlockNumber: bigint | undefined

  for (const block of blocks) {
    if (block.number < startHeight || block.number > endHeight) {
      throw new Error('Invalid snapshot: block number is outside the snapshot range')
    }

    previousBlockNumber = assertAscendingKey(
      block.number,
      previousBlockNumber,
      kind => kind === 'duplicate'
        ? `duplicate block number ${block.number}`
        : 'blocks must be strictly ascending by number'
    )

    let previousTransactionIndex: number | undefined
    for (const transaction of block.transactions) {
      previousTransactionIndex = assertAscendingKey(
        transaction.index,
        previousTransactionIndex,
        kind => kind === 'duplicate'
          ? `duplicate transaction index ${transaction.index} in block ${block.number}`
          : `transactions in block ${block.number} must be strictly ascending by index`
      )
    }
  }
}

/**
 * Yield commitment batches in artifact order.
 * @param blocks - Decoded blocks.
 * @yields Commitment batches.
 */
function * commitmentBatches (
  blocks: SnapshotBlock[]
): Generator<SnapshotCommitmentPosition[]> {
  for (const block of blocks) {
    for (const transaction of block.transactions) {
      for (const batch of transaction.actions) {
        for (const action of batch) {
          const commitments: SnapshotCommitmentPosition[] = []
          if (action.commitment !== undefined) {
            commitments.push(action.commitment)
          }
          for (const commitment of action.commitments ?? []) {
            commitments.push(commitment)
          }
          if (commitments.length > 0) {
            yield commitments
          }
        }
      }
    }
  }
}

/**
 * Validate one action-level commitment batch.
 * @param batch - Commitment batch.
 */
function validateCommitmentBatch (
  batch: SnapshotCommitmentPosition[]
): void {
  const firstCommitment = batch[0]
  if (firstCommitment === undefined) {
    return
  }
  const batchTreeNumber = firstCommitment.treeNumber

  let previousPosition: number | undefined
  for (const commitment of batch) {
    const { treeNumber, treePosition } = commitment

    if (treeNumber !== batchTreeNumber) {
      throw new Error(
        'Invalid snapshot: commitment batches cannot cross tree boundaries'
      )
    }

    const positionBeforeCommitment = previousPosition
    previousPosition = assertAscendingKey(
      treePosition,
      positionBeforeCommitment,
      kind => kind === 'duplicate'
        ? `duplicate commitment position ${treePosition} in tree ${treeNumber}`
        : `commitment positions in tree ${treeNumber} must be strictly ascending`
    )

    if (
      positionBeforeCommitment !== undefined &&
      treePosition !== positionBeforeCommitment + 1
    ) {
      throw new Error(
        `Invalid snapshot: commitment position gap in tree ${treeNumber}`
      )
    }
  }
}

/**
 * Validate canonical Merkle insertion ordering for commitment entries.
 * @param snapshot - Decoded snapshot.
 */
function validateCommitmentOrdering (
  snapshot: Pick<Snapshot, 'chainID' | 'startHeight' | 'endHeight' | 'blocks'>
): void {
  const deploymentBlock = getDeploymentBlock(snapshot.chainID)
  const requiresColdStartPrefix = snapshot.startHeight <= deploymentBlock &&
    snapshot.endHeight >= deploymentBlock

  let previousTreeNumber: number | undefined
  let previousTreePosition: number | undefined

  for (const batch of commitmentBatches(snapshot.blocks)) {
    validateCommitmentBatch(batch)

    const firstCommitment = batch[0]
    const lastCommitment = batch[batch.length - 1]
    if (firstCommitment === undefined || lastCommitment === undefined) {
      continue
    }

    const { treeNumber, treePosition } = firstCommitment

    if (
      previousTreeNumber === undefined &&
      requiresColdStartPrefix &&
      (treeNumber !== 0 || treePosition !== 0)
    ) {
      throw new Error(
        'Invalid snapshot: cold-start commitments must start at tree 0 position 0'
      )
    }

    if (
      previousTreeNumber !== undefined &&
      previousTreePosition !== undefined &&
      treeNumber < previousTreeNumber
    ) {
      throw new Error(
        'Invalid snapshot: commitment tree numbers must be nondecreasing'
      )
    }

    if (
      previousTreeNumber !== undefined &&
      previousTreePosition !== undefined &&
      treeNumber > previousTreeNumber
    ) {
      if (treeNumber !== previousTreeNumber + 1) {
        throw new Error(
          'Invalid snapshot: commitment tree numbers cannot skip represented trees'
        )
      }

      const remainingPositions =
        TREE_MAX_ITEMS - (previousTreePosition + 1)
      if (batch.length <= remainingPositions) {
        throw new Error(
          'Invalid snapshot: commitment tree transition before previous tree prefix is complete'
        )
      }

      if (treePosition !== 0) {
        throw new Error(
          'Invalid snapshot: commitment positions must start at 0 after a tree transition'
        )
      }
    }

    if (
      previousTreeNumber !== undefined &&
      previousTreePosition !== undefined &&
      treeNumber === previousTreeNumber
    ) {
      assertAscendingKey(
        treePosition,
        previousTreePosition,
        kind => kind === 'duplicate'
          ? `duplicate commitment position ${treePosition} in tree ${treeNumber}`
          : `commitment positions in tree ${treeNumber} must be strictly ascending`
      )
      if (treePosition !== previousTreePosition + 1) {
        throw new Error(
          `Invalid snapshot: commitment position gap in tree ${treeNumber}`
        )
      }
    }

    previousTreeNumber = lastCommitment.treeNumber
    previousTreePosition = lastCommitment.treePosition
  }
}

/**
 * Validate and normalize a decoded snapshot.
 * @param value - Decoded root value.
 * @returns Snapshot domain object.
 */
function validateSnapshot (value: unknown): Snapshot {
  const decoded = requireRecord(value, 'root')
  const version = requireInteger(decoded['version'], 'version')
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`Invalid snapshot: unsupported version ${version}`)
  }

  const chainID = requireInteger(decoded['chainID'], 'chainID')
  if (chainID < 0) {
    throw new Error('Invalid snapshot: chainID cannot be negative')
  }

  const startHeight = normalizeHeight(decoded['startHeight'], 'startHeight')
  const endHeight = normalizeHeight(decoded['endHeight'], 'endHeight')
  if (startHeight > endHeight) {
    throw new Error('Invalid snapshot: startHeight cannot be greater than endHeight')
  }

  const entryCount = requireInteger(decoded['entryCount'], 'entryCount')
  if (entryCount < 0) {
    throw new Error('Invalid snapshot: entryCount cannot be negative')
  }

  if (!Array.isArray(decoded['blocks'])) {
    throw new Error('Invalid snapshot: blocks must be an array')
  }
  const blocks = decoded['blocks'].map(validateBlock)

  validateBlockAndTransactionOrdering(blocks, startHeight, endHeight)

  const actualEntryCount = blocks.reduce(
    (blockTotal, block) => blockTotal + block.transactions.reduce(
      (transactionTotal, transaction) =>
        transactionTotal + transaction.actions.reduce(
          (actionTotal, batch) => actionTotal + batch.length,
          0
        ),
      0
    ),
    0
  )
  if (entryCount !== actualEntryCount) {
    throw new Error(
      `Invalid snapshot: entryCount ${entryCount} does not match ${actualEntryCount} actions`
    )
  }

  const snapshot = {
    version,
    chainID,
    startHeight,
    endHeight,
    entryCount,
    blocks
  }
  validateCommitmentOrdering(snapshot)

  return snapshot
}

/**
 * Verify artifact bytes against the expected CID.
 * @param bytes - Compressed artifact bytes.
 * @param expectedCid - Expected artifact CID.
 */
async function verifyArtifactCID (
  bytes: Uint8Array,
  expectedCid: string
): Promise<void> {
  let expected
  try {
    expected = CID.parse(expectedCid)
  } catch (err) {
    throw new Error(`Invalid expected snapshot CID: ${expectedCid}`, {
      cause: err
    })
  }

  const actualCid = await artifactCIDFromBytes(bytes)
  if (!CID.parse(actualCid).equals(expected)) {
    throw new Error(
      `Snapshot CID mismatch: expected ${expectedCid}, got ${actualCid}`
    )
  }
}

/**
 * Canonicalize blocks for producer-side encoding.
 * @param blocks - Candidate block data.
 * @param metadata - Snapshot metadata.
 * @returns Blocks sorted by number with transactions sorted by index.
 */
function canonicalizeBlocks (
  blocks: EncodeSnapshotBlock[],
  metadata: EncodeSnapshotMetadata
): SnapshotBlock[] {
  const filteredBlocks = blocks.filter((block) => {
    const blockNumber = BigInt(block.number)
    return blockNumber >= metadata.startHeight &&
      blockNumber <= metadata.endHeight
  })

  return [...filteredBlocks]
    .sort((left, right) => {
      const leftNumber = BigInt(left.number)
      const rightNumber = BigInt(right.number)
      return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
    })
    .map((block) => {
      if (!Array.isArray(block.transactions)) {
        throw new Error('Invalid snapshot: block transactions must be an array')
      }

      const transactions = [...block.transactions]
        .sort((left, right) => left.index - right.index)
        .map((transaction): SnapshotTransaction => {
          return {
            ...transaction,
            hash: transaction.hash,
            index: transaction.index,
            from: transaction.from,
            actions: canonicalizeActionBatchesForEncode(transaction.actions)
          }
        })

      return {
        ...block,
        number: BigInt(block.number),
        hash: block.hash,
        timestamp: BigInt(block.timestamp),
        transactions
      }
    })
}

/**
 * Decode uncompressed DAG-CBOR snapshot bytes into a validated snapshot.
 * @param bytes - Uncompressed DAG-CBOR snapshot bytes.
 * @returns Decoded and validated snapshot.
 */
function decodeSnapshotContent (bytes: Uint8Array): Snapshot {
  const decoded = DAGCBORCodec.decodeFromBytes<unknown>(bytes)
  return validateSnapshot(decoded)
}

/**
 * Encode railgun blocks into deterministic DAG-CBOR snapshot content.
 * @param blocks - Input blocks to encode.
 * @param metadata - Chain and block range metadata.
 * @returns Uncompressed DAG-CBOR snapshot bytes.
 */
function encodeSnapshotContent (
  blocks: EncodeSnapshotBlock[],
  metadata: EncodeSnapshotMetadata
): Uint8Array {
  const { chainID, startHeight, endHeight } = metadata

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const canonicalBlocks = canonicalizeBlocks(blocks, metadata)

  const entryCount = canonicalBlocks.reduce(
    (acc, block) => acc + (block.transactions?.reduce(
      (transactionTotal, transaction) =>
        transactionTotal + (transaction.actions?.flat().length ?? 0),
      0
    ) ?? 0),
    0)

  const snapshotContent = {
    version: SNAPSHOT_VERSION,
    chainID,
    startHeight,
    endHeight,
    entryCount,
    blocks: canonicalBlocks
  }
  const snapshot = validateSnapshot(snapshotContent)

  return DAGCBORCodec.encodeToBytes({
    ...snapshotContent,
    version: snapshot.version,
    chainID: snapshot.chainID,
    startHeight: snapshot.startHeight,
    endHeight: snapshot.endHeight,
    entryCount: snapshot.entryCount
  })
}

export {
  BROTLI_QUALITY,
  MAX_DECOMPRESSED_SIZE,
  decodeSnapshotContent,
  encodeSnapshotContent,
  verifyArtifactCID
}
export type { EncodeSnapshotBlock, EncodeSnapshotMetadata }
