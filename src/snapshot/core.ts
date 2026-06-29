import fs from 'fs'
import zlib from 'zlib'

import type { EVMBlock } from '@railgun-reloaded/scanner'
import { SubsquidProvider } from '@railgun-reloaded/scanner'

import { getNetworkConfigFromChainID } from '../config'
import { artifactCIDFromBytes } from '../lib/content'
import { RailgunDB } from '../lib/database'
import { getMultiformats, initializeFormats } from '../lib/formats'

import { DAGCBORCodec } from './dagcbor-codec'
import type {
  Snapshot,
  SnapshotAction,
  SnapshotBlock,
  SnapshotBytes,
  SnapshotMemo,
  SnapshotTransaction
} from './types'
import { minBigInts } from './utils'

const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024
// The artifact CID uses the raw codec (0x55) to honestly describe the opaque
// brotli-compressed bytes it addresses. This is the single current artifact
// format; there is no prior on-artifact format to migrate from.
const SNAPSHOT_VERSION = 1

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

  if (action['commitments'] !== undefined) {
    if (!Array.isArray(action['commitments'])) {
      throw new Error('Invalid snapshot: commitments must be an array')
    }
    validated.commitments = action['commitments'].map((value) => {
      const commitment = requireRecord(value, 'commitment')
      if (!isMemo(commitment['memo'])) {
        throw new Error('Invalid snapshot: commitment memo has invalid bytes')
      }
      return {
        ...commitment,
        memo: commitment['memo']
      }
    })
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

  for (const block of blocks) {
    if (block.number < startHeight || block.number > endHeight) {
      throw new Error('Invalid snapshot: block number is outside the snapshot range')
    }
  }

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

  return {
    version,
    chainID,
    startHeight,
    endHeight,
    entryCount,
    blocks
  }
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
  const { CID } = getMultiformats()
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
 * DAG-CBOR-decodes, and validates the artifact shape. CID verification happens
 * before decompression, so tampered bytes are rejected before any decode work.
 * @param bytes - Compressed snapshot artifact bytes.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded and validated snapshot.
 */
async function decodeArtifact (bytes: Uint8Array, expectedCid: string): Promise<Snapshot> {
  await initializeFormats()
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
 * Filter the input data within the range of start and end height and create snapshot data.
 * Encode the snapshot using DAGCBOR encoding and compress it using brotli compression
 * @param blocks - Input block to encode
 * @param metadata - Chain/Block related metadata
 * @param metadata.chainID - ChainID of the network
 * @param metadata.startHeight - Startheight of the block
 * @param metadata.endHeight - End Height of the block
 * @returns - Encoded data
 */
function encodeSnapshot (blocks: EVMBlock[], metadata: {
  chainID: number,
  startHeight: bigint,
  endHeight: bigint
}) : Uint8Array {
  const { chainID, startHeight, endHeight } = metadata

  // Validate height range
  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const filteredBlocks = blocks.filter((blk) => {
    const blockNumber = BigInt(blk.number)
    return blockNumber >= metadata.startHeight && blockNumber <= metadata.endHeight
  })

  // Calculate total number of action entries from the transaction
  const entryCount = filteredBlocks.reduce(
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
    blocks: filteredBlocks
  }

  const bytes = DAGCBORCodec.encodeToBytes(snapshotContent)
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
async function encodeSnapshotFromDB (db: RailgunDB, metadata: {
  chainID: number,
  startHeight: bigint,
  endHeight: bigint
}) : Promise<Uint8Array> {
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
