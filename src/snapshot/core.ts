import fs from 'fs'
import zlib from 'zlib'

import type { EVMBlock } from '@railgun-reloaded/scanner'
import { SubsquidProvider } from '@railgun-reloaded/scanner'

import { getNetworkConfigFromChainID } from '../config/index.js'
import { artifactCIDFromBytes } from '../lib/content/index.js'
import { RailgunDB } from '../lib/database/index.js'
import { CID } from '../lib/formats/index.js'

import { DAGCBORCodec } from './dagcbor-codec.js'
import type {
  Snapshot,
  SnapshotAction,
  SnapshotBlock,
  SnapshotBytes,
  SnapshotCommitment,
  SnapshotMemo,
  SnapshotTransaction
} from './types.js'
import { minBigInts } from './utils.js'

const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024
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
 * Return the configured deployment block when this package knows the chain.
 * @param chainID - EVM chain ID.
 * @returns Deployment block, if known.
 */
function getDeploymentBlock (chainID: number): bigint | undefined {
  try {
    return getNetworkConfigFromChainID(chainID).deploymentBlock
  } catch {
    return undefined
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

  if (requireMemo || commitment['memo'] !== undefined) {
    if (!isMemo(commitment['memo'])) {
      throw new Error('Invalid snapshot: commitment memo has invalid bytes')
    }
    validated.memo = commitment['memo']
  }

  return validated
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
 * Yield commitment entries in artifact order.
 * @param blocks - Decoded blocks.
 * @yields Commitment entries.
 */
function * commitmentEntries (
  blocks: SnapshotBlock[]
): Generator<Pick<SnapshotCommitment, 'treeNumber' | 'treePosition'>> {
  for (const block of blocks) {
    for (const transaction of block.transactions) {
      for (const batch of transaction.actions) {
        for (const action of batch) {
          if (action.commitment !== undefined) {
            yield action.commitment
          }
          for (const commitment of action.commitments ?? []) {
            yield commitment
          }
        }
      }
    }
  }
}

/**
 * Validate canonical Merkle insertion ordering for commitment entries.
 * @param snapshot - Decoded snapshot.
 */
function validateCommitmentOrdering (
  snapshot: Pick<Snapshot, 'chainID' | 'startHeight' | 'blocks'>
): void {
  const deploymentBlock = getDeploymentBlock(snapshot.chainID)
  const requiresColdStartPrefix = deploymentBlock !== undefined &&
    snapshot.startHeight === deploymentBlock

  let previousTreeNumber: number | undefined
  let isFirstCommitment = true
  const previousPositionByTree = new Map<number, number>()

  for (const commitment of commitmentEntries(snapshot.blocks)) {
    const { treeNumber, treePosition } = commitment

    if (
      isFirstCommitment &&
      requiresColdStartPrefix &&
      (treeNumber !== 0 || treePosition !== 0)
    ) {
      throw new Error(
        'Invalid snapshot: cold-start commitments must start at tree 0 position 0'
      )
    }

    if (previousTreeNumber !== undefined && treeNumber < previousTreeNumber) {
      throw new Error(
        'Invalid snapshot: commitment tree numbers must be nondecreasing'
      )
    }

    if (previousTreeNumber !== undefined && treeNumber > previousTreeNumber) {
      if (treeNumber !== previousTreeNumber + 1) {
        throw new Error(
          'Invalid snapshot: commitment tree numbers cannot skip represented trees'
        )
      }

      const previousPosition = previousPositionByTree.get(previousTreeNumber)
      if (previousPosition !== TREE_MAX_ITEMS - 1) {
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

    const previousPosition = previousPositionByTree.get(treeNumber)
    assertAscendingKey(
      treePosition,
      previousPosition,
      kind => kind === 'duplicate'
        ? `duplicate commitment position ${treePosition} in tree ${treeNumber}`
        : `commitment positions in tree ${treeNumber} must be strictly ascending`
    )
    if (previousPosition !== undefined && treePosition !== previousPosition + 1) {
      throw new Error(
        `Invalid snapshot: commitment position gap in tree ${treeNumber}`
      )
    }

    previousPositionByTree.set(treeNumber, treePosition)
    previousTreeNumber = treeNumber
    isFirstCommitment = false
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
 * Decode a verified snapshot artifact from in-memory bytes.
 *
 * This is the single consumer entry point for the artifact lifecycle: it
 * content-addresses the bytes against `expectedCid`, brotli-decompresses,
 * DAG-CBOR-decodes, and validates the artifact shape and canonical ordering.
 * CID verification happens before decompression, so tampered bytes are rejected
 * before any decode work.
 *
 * Decoded artifacts must contain strictly ascending, unique block numbers;
 * strictly ascending, unique transaction indexes within each block; and
 * commitment entries that are already canonical Merkle insertion order by
 * `treeNumber` and `treePosition`.
 * @param bytes - Compressed snapshot artifact bytes.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded and validated snapshot.
 */
async function decodeArtifact (bytes: Uint8Array, expectedCid: string): Promise<Snapshot> {
  await verifyArtifactCID(bytes, expectedCid)

  const decompressed = zlib.brotliDecompressSync(bytes, {
    maxOutputLength: MAX_DECOMPRESSED_SIZE
  })

  const decoded = DAGCBORCodec.decodeFromBytes<unknown>(decompressed)
  return validateSnapshot(decoded)
}

/**
 * Encode railgun blocks into DAG-CBOR and compress it using brotli compression. Also calculate
 * CID and write the compressed data into outPath
 * @param outPath - output .rsnap path
 * @param bytes - Byte representation of snapshot data
 * @returns - Promise to writeFile
 */
async function writeSnapshot (
  outPath: string,
  bytes: Uint8Array
): Promise<void> {
  return fs.promises.writeFile(outPath, bytes)
}

/**
 * Canonicalize blocks for producer-side encoding.
 * @param blocks - Candidate block data.
 * @param metadata - Snapshot metadata.
 * @returns Blocks sorted by number with transactions sorted by index.
 */
function canonicalizeBlocks (
  blocks: EVMBlock[],
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
          const rawActions = (transaction as { actions?: unknown }).actions
          if (rawActions !== undefined && !Array.isArray(rawActions)) {
            throw new Error('Invalid snapshot: transaction actions must be an array')
          }

          return {
            hash: transaction.hash,
            index: transaction.index,
            from: transaction.from,
            actions: rawActions === undefined
              ? []
              : rawActions as SnapshotAction[][]
          }
        })

      return {
        number: BigInt(block.number),
        hash: block.hash,
        timestamp: BigInt(block.timestamp),
        transactions
      }
    })
}

/**
 * Filter the input data within the range of start and end height and create snapshot data.
 * Canonicalize blocks by number and transactions by index, then encode the
 * snapshot using DAGCBOR encoding and compress it using brotli compression.
 *
 * Commitment-bearing actions are not reordered. They must already be in
 * canonical Merkle insertion order by `treeNumber` and `treePosition`, with no
 * duplicates or gaps in the represented span. Non-commitment action batches
 * preserve their source transaction/log order.
 *
 * `encodeSnapshot` is synchronous; its output is byte-identical for the same
 * input.
 * @param blocks - Input block to encode
 * @param metadata - Chain/Block related metadata
 * @param metadata.chainID - ChainID of the network
 * @param metadata.startHeight - Startheight of the block
 * @param metadata.endHeight - End Height of the block
 * @returns - Encoded data
 */
function encodeSnapshot (blocks: EVMBlock[], metadata: EncodeSnapshotMetadata) : Uint8Array {
  const { chainID, startHeight, endHeight } = metadata

  // Validate height range
  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const canonicalBlocks = canonicalizeBlocks(blocks, metadata)

  // Calculate total number of action entries from the transaction
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

  const bytes = DAGCBORCodec.encodeToBytes(snapshot)
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6
    }
  })
}

/**
 * Filter the data from DB in the range of [startHeight, endHeight] and create snapshot data.
 * Encode the snapshot using DAGCBOR encoding and compress it using brotli compression
 * @param db - Encode snapshot from DB
 * @param metadata - Chain/Block related metadata
 * @param metadata.chainID - ChainID of the network
 * @param metadata.startHeight - Startheight of the block
 * @param metadata.endHeight - End Height of the block
 * @returns - Encoded data
 */
async function encodeSnapshotFromDB (db: RailgunDB, metadata: EncodeSnapshotMetadata) : Promise<Uint8Array> {
  const blocks = await db.get<EVMBlock[]>('blocks') ?? []
  return encodeSnapshot(blocks, metadata)
}

/**
 * Decode a compressed DAG-CBOR snapshot into metaData and eventBlocks
 * from file
 * @param filePath - Filepath to the encoded snapshot
 * @param expectedCid - CID the bytes must content-address to.
 * @returns - Decoded snapshot data
 */
async function decodeSnapshot (filePath: string, expectedCid: string): Promise<Snapshot> {
  const data = new Uint8Array(await fs.promises.readFile(filePath))
  return decodeArtifact(data, expectedCid)
}

/**
 * Decode a compressed DAG-CBOR snapshot into metaData and eventBlocks
 * from file and write to DB
 * @param filePath - Filepath to the encoded snapshot
 * @param db - RailgunDatabase Instance
 * @param expectedCid - CID the bytes must content-address to.
 * @returns - Decoded snapshot data
 */
async function decodeSnapshotToDB (filePath: string, db: RailgunDB, expectedCid: string): Promise<Snapshot> {
  const decodedData = await decodeSnapshot(filePath, expectedCid)

  db.set('latestHeight', decodedData.endHeight)
  db.set('blocks', decodedData.blocks)

  return decodedData
}

/**
 * Create snapshot by aggregating blocks from providers into DB, encode and compress it
 * and write to file. Return the calculated CID of the final data
 * @param createOptions - Snapshot create options
 * @param createOptions.chainID - ChainID
 * @param createOptions.dbName - Database name
 * @param createOptions.snapshotFilename - Output snapshot filename
 * @param createOptions.startHeight - Starting height of the output snapshot
 * @param createOptions.endHeight - End height of the output snapshot
 * @returns - CID of created snapshot file
 */
async function createSnapshot (createOptions: {
  chainID: number;
  dbName: string;
  snapshotFilename: string;
  startHeight?: bigint;
  endHeight?: bigint;
}) {
  const { chainID, dbName, snapshotFilename } = createOptions

  if (!chainID) {
    throw new Error('ChainID is not defined')
  }
  const { rpcURL, subsquidURL, deploymentBlock } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  // Determine the starting height for this snapshot
  // Priority: user-specified startHeight > last scanned + 1 > deployment block
  let startHeight: bigint
  if (createOptions.startHeight) {
    startHeight = createOptions.startHeight
  } else if (lastScannedHeight) {
    startHeight = BigInt(lastScannedHeight) + 1n
  } else {
    startHeight = BigInt(deploymentBlock)
  }

  const latestHeight = await subsquidProvider.head()
  const endHeight = createOptions.endHeight ? minBigInts(createOptions.endHeight, latestHeight) : latestHeight

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  console.log(`SubsquidProvider latest height: ${latestHeight}`)

  const blockIterator = subsquidProvider.from({
    startHeight,
    liveSync: false,
    endHeight,
  })

  const blocks = await db.get<EVMBlock[]>('blocks') ?? []
  console.log(`Starting with ${blocks.length} existing blocks in DB`)

  for await (const block of blockIterator) {
    blocks.push(block)
  }

  await Promise.all([
    db.set('latestHeight', endHeight.toString()),
    db.set('blocks', blocks)
  ])

  const encodedData = encodeSnapshot(blocks, {
    chainID,
    startHeight,
    endHeight
  })

  await writeSnapshot(snapshotFilename, encodedData)

  try { await (db as any).levelDB.close?.() } catch { }

  return artifactCIDFromBytes(encodedData)
}

export { createSnapshot, writeSnapshot, encodeSnapshot, decodeArtifact, decodeSnapshot, encodeSnapshotFromDB, decodeSnapshotToDB }
export type { EncodeSnapshotMetadata }
