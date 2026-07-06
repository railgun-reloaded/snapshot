import assert from 'node:assert/strict'
import fs from 'node:fs'
import { before, test } from 'node:test'
import zlib from 'node:zlib'

import { getNetworkConfigFromChainID } from '../src/config/index.js'
import type { Snapshot, SnapshotAction, SnapshotBlock, SnapshotCommitment, SnapshotMemoCommitment, SnapshotTransaction } from '../src/index.js'
import { artifactCIDFromBytes, computeArtifactCID, writeCarWithArtifactRoot } from '../src/lib/content/index.js'
import { RailgunDB } from '../src/lib/database/index.js'
import { CID } from '../src/lib/formats/index.js'
import { decodeArtifact, decodeSnapshot, encodeSnapshot, encodeSnapshotFromDB, writeSnapshot } from '../src/snapshot/core.js'
import { DAGCBORCodec } from '../src/snapshot/dagcbor-codec.js'

import { loadBlockchainEvents } from './fixtures/index.js'
import { TEST_VECTOR_EVENTS3 } from './test-vectors.js'
import { cleanup, exists, makeTmpPath } from './utils.js'

let rgEventBlocks: any[] = []

const RAW_SNAPSHOT_VERSION = 1
const TEST_CHAIN_ID = 11155111

/**
 * Build deterministic bytes for ordering tests.
 * @param seed - First byte seed.
 * @param length - Output length.
 * @returns Deterministic byte array.
 */
function makeBytes (seed: number, length = 32): Uint8Array {
  return Uint8Array.from(
    { length },
    (_, index) => (seed + index) % 256
  )
}

/**
 * Build a positioned commitment for ordering tests.
 * @param treeNumber - Commitment tree number.
 * @param treePosition - Commitment tree position.
 * @param seed - Hash byte seed.
 * @returns Snapshot commitment.
 */
function makeCommitment (
  treeNumber: number,
  treePosition: number,
  seed = treePosition
): SnapshotMemoCommitment {
  return {
    hash: makeBytes(seed),
    memo: new Uint8Array([]),
    treeNumber,
    treePosition
  }
}

/**
 * Build a multi-commitment action.
 * @param commitments - Commitment entries.
 * @param label - Optional ordering label.
 * @returns Snapshot action.
 */
function makeCommitmentAction (
  commitments: SnapshotMemoCommitment[],
  label?: string
): SnapshotAction {
  return {
    actionType: 'EncryptedCommitment',
    txID: makeBytes(1),
    nullifiers: [],
    commitments,
    boundParamsHash: makeBytes(2),
    utxoBatchStartPositionOut: commitments[0]?.treePosition ?? 0,
    utxoTreeIn: commitments[0]?.treeNumber ?? 0,
    utxoTreeOut: commitments[0]?.treeNumber ?? 0,
    hasUnshield: false,
    ...(label !== undefined && { label })
  }
}

/**
 * Build a single-commitment action.
 * @param commitment - Commitment entry.
 * @returns Snapshot action.
 */
function makeSingleCommitmentAction (
  commitment: SnapshotCommitment
): SnapshotAction {
  return {
    actionType: 'GeneratedCommitment',
    batchStartTreePosition: commitment.treePosition,
    commitment
  }
}

/**
 * Build a non-commitment action.
 * @param label - Ordering label.
 * @returns Snapshot action.
 */
function makeNonCommitmentAction (label: string): SnapshotAction {
  return {
    actionType: 'Unshield',
    label
  }
}

/**
 * Build a snapshot transaction.
 * @param index - Transaction index.
 * @param actions - Action batches.
 * @param seed - Hash byte seed.
 * @returns Snapshot transaction.
 */
function makeTransaction (
  index: number,
  actions: SnapshotAction[][],
  seed = index
): SnapshotTransaction {
  return {
    hash: makeBytes(seed),
    index,
    from: makeBytes(seed + 20, 20),
    actions
  }
}

/**
 * Build a snapshot block.
 * @param number - Block number.
 * @param transactions - Block transactions.
 * @param seed - Hash byte seed.
 * @returns Snapshot block.
 */
function makeBlock (
  number: bigint,
  transactions: SnapshotTransaction[] = [],
  seed = Number(number % 1000n)
): SnapshotBlock {
  return {
    number,
    hash: makeBytes(seed),
    timestamp: number * 1000n,
    transactions
  }
}

/**
 * Count action entries in snapshot blocks.
 * @param blocks - Snapshot blocks.
 * @returns Action count.
 */
function countActions (blocks: SnapshotBlock[]): number {
  return blocks.reduce(
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
}

/**
 * Build a raw snapshot root object.
 * @param blocks - Snapshot blocks.
 * @param overrides - Root field overrides.
 * @returns Snapshot root.
 */
function makeSnapshot (
  blocks: SnapshotBlock[],
  overrides: Partial<Snapshot> = {}
): Snapshot {
  const heights = blocks.map(block => block.number)
  const startHeight = heights.length > 0
    ? heights.reduce((left, right) => left < right ? left : right)
    : 0n
  const endHeight = heights.length > 0
    ? heights.reduce((left, right) => left > right ? left : right)
    : 0n

  return {
    version: RAW_SNAPSHOT_VERSION,
    chainID: TEST_CHAIN_ID,
    startHeight,
    endHeight,
    entryCount: countActions(blocks),
    blocks,
    ...overrides
  }
}

/**
 * Encode a raw root object without producer canonicalization.
 * @param value - Raw snapshot-like root.
 * @returns Compressed artifact bytes.
 */
function encodeRawArtifact (value: Record<string, unknown>): Uint8Array {
  const bytes = DAGCBORCodec.encodeToBytes(value)
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6
    }
  })
}

/**
 * Decode a raw root object through the artifact decoder.
 * @param value - Raw snapshot-like root.
 * @returns Decoded snapshot.
 */
async function decodeRawArtifact (
  value: Record<string, unknown>
): Promise<Snapshot> {
  const encoded = encodeRawArtifact(value)
  const cid = await artifactCIDFromBytes(encoded)
  return decodeArtifact(encoded, cid)
}

/**
 * Encode test blocks through the public producer.
 * @param blocks - Snapshot-shaped test blocks.
 * @param metadata - Snapshot metadata.
 * @returns Compressed artifact bytes.
 */
function encodeTestSnapshot (
  blocks: SnapshotBlock[],
  metadata: Parameters<typeof encodeSnapshot>[1]
): Uint8Array {
  return encodeSnapshot(blocks, metadata)
}

/**
 * Decode already encoded artifact bytes.
 * @param encoded - Compressed artifact bytes.
 * @returns Decoded snapshot.
 */
async function decodeEncodedSnapshot (encoded: Uint8Array): Promise<Snapshot> {
  const cid = await artifactCIDFromBytes(encoded)
  return decodeArtifact(encoded, cid)
}

/**
 * Collect commitments in artifact order.
 * @param snapshot - Decoded snapshot.
 * @returns Commitment entries.
 */
function collectCommitments (snapshot: Snapshot): SnapshotCommitment[] {
  const commitments: SnapshotCommitment[] = []
  for (const block of snapshot.blocks) {
    for (const transaction of block.transactions) {
      for (const batch of transaction.actions) {
        for (const action of batch) {
          if (action.commitment) {
            commitments.push(action.commitment)
          }
          commitments.push(...(action.commitments ?? []))
        }
      }
    }
  }
  return commitments
}

/**
 * Read a commitment hash from a test commitment.
 * @param commitment - Snapshot commitment.
 * @returns Commitment hash bytes.
 */
function commitmentHash (commitment: SnapshotCommitment): Uint8Array {
  const hash = commitment['hash']
  assert.ok(hash instanceof Uint8Array)
  return hash
}

/**
 * Simulate wallet-sdk block batch appends for ordering tests.
 * @param snapshot - Decoded snapshot.
 * @param blockBatchSize - Number of blocks per batch.
 * @returns Appended commitment hashes.
 */
function appendCommitmentsByBlockBatch (
  snapshot: Snapshot,
  blockBatchSize: number
): Uint8Array[] {
  const appended: Uint8Array[] = []
  for (let index = 0; index < snapshot.blocks.length; index += blockBatchSize) {
    const batchSnapshot = {
      ...snapshot,
      blocks: snapshot.blocks.slice(index, index + blockBatchSize)
    }
    const batchCommitments = collectCommitments(batchSnapshot)
      .sort((left, right) => left.treePosition - right.treePosition)
    appended.push(...batchCommitments.map(commitmentHash))
  }
  return appended
}

before(() => {
  const data = loadBlockchainEvents()
  rgEventBlocks = data.blocks.map(block => ({
    ...block,
    number: BigInt(block.number),
    timestamp: BigInt(block.timestamp)
  }))
})

test('DAGCBORCodec bigint tags', () => {
  const positive = 2n ** 80n
  const negative = -(2n ** 80n)
  const encoded = DAGCBORCodec.encodeToBytes({ positive, negative })
  const decoded = DAGCBORCodec.decodeFromBytes<{
    positive: bigint
    negative: bigint
  }>(encoded)

  assert.equal(decoded.positive, positive)
  assert.equal(decoded.negative, negative)
})

test('Snapshot basic encoding', async (t) => {
  await t.test('should produce same cid from bytes and snapshot file', async () => {
    const out = makeTmpPath('snap') + '.rsnap'
    const firstBlock = BigInt(rgEventBlocks[0].number)

    const encodedData = encodeSnapshot(rgEventBlocks, {
      chainID: 1,
      startHeight: firstBlock,
      endHeight: firstBlock
    })

    const cid = await artifactCIDFromBytes(encodedData)

    await writeSnapshot(out, encodedData)
    const verify = await computeArtifactCID(out)
    assert.equal(verify, cid)

    const root = await decodeSnapshot(out, cid)
    assert.equal(root.version, 1)
    assert.equal(root.chainID, 1)
    assert.equal(BigInt(root.startHeight), firstBlock)
    assert.equal(BigInt(root.endHeight), firstBlock)
    assert.equal(root.blocks.length, 1)
    const expectedBlocks = rgEventBlocks[0].transactions.reduce((sum: number, tx: any) => sum + (tx.actions?.flat().length ?? 0), 0)
    assert.equal(root.entryCount, expectedBlocks)

    cleanup(out)
  })

  await t.test('should produce identical CID for identical real blockchain data', async () => {
    const blockNumber = rgEventBlocks[0].number

    const metaData = {
      chainID: 1,
      startHeight: blockNumber,
      endHeight: blockNumber
    }

    const encodedData1 = encodeSnapshot(rgEventBlocks, metaData)
    const encodedData2 = encodeSnapshot(rgEventBlocks, metaData)

    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    await writeSnapshot(out1, encodedData1)
    await writeSnapshot(out2, encodedData2)

    const [verify1, verify2] = await Promise.all([computeArtifactCID(out1), computeArtifactCID(out2)])
    assert.equal(verify1, verify2)

    cleanup(out1, out2)
  })

  await t.test('should produce different CID for different real blocks', async () => {
    const dbPath = makeTmpPath('db')
    const db = new RailgunDB()

    // Store all blocks in database, then snapshot different ranges
    await db.set('blocks', rgEventBlocks)

    const encodedData1 = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[0].number })
    const cid1 = await artifactCIDFromBytes(encodedData1)

    const encodedData2 = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: rgEventBlocks[Math.min(1, rgEventBlocks.length - 1)].number, endHeight: rgEventBlocks[Math.min(1, rgEventBlocks.length - 1)].number })
    const cid2 = await artifactCIDFromBytes(encodedData2)

    assert.notEqual(cid1, cid2)

    cleanup(dbPath)
  })
})

test('Snapshot .CAR Integration', async (t) => {
  await t.test('should have root CID matching encoded file CID', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const car = makeTmpPath('car') + '.car'
    const db = new RailgunDB()

    const data = loadBlockchainEvents()
    const firstBlock = {
      ...data.blocks[0],
      number: BigInt(data.blocks[0].number),
      timestamp: BigInt(data.blocks[0].timestamp)
    }

    await db.set('blocks', [firstBlock])

    const encodedData = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: BigInt(data.blocks[0].number), endHeight: BigInt(data.blocks[0].number) })
    await writeSnapshot(out, encodedData)

    const cid = await computeArtifactCID(out)
    await writeCarWithArtifactRoot(out, car)

    const bytes = await fs.promises.readFile(car)
    const { CarReader } = await import('@ipld/car')
    const reader = await CarReader.fromBytes(bytes)
    const roots = await reader.getRoots()
    assert.ok(roots.length > 0)
    const rootStr = roots[0]!.toString()
    assert.equal(rootStr, cid)

    cleanup(dbPath, out, car)
  })
})

test('Snapshot artifact codec honesty', async (t) => {
  const RAW_CODEC = 0x55

  await t.test('artifact CID uses the raw codec', async () => {
    const firstBlock = BigInt(rgEventBlocks[0].number)
    const encoded = encodeSnapshot(rgEventBlocks, {
      chainID: 1,
      startHeight: firstBlock,
      endHeight: firstBlock
    })

    const cidStr = await artifactCIDFromBytes(encoded)
    const cid = CID.parse(cidStr)

    assert.equal(cid.code, RAW_CODEC)
    assert.equal(cid.version, 1)
  })

  await t.test('CAR root codec matches the encoded bytes (raw)', async () => {
    const out = makeTmpPath('snap') + '.rsnap'
    const car = makeTmpPath('car') + '.car'
    const firstBlock = BigInt(rgEventBlocks[0].number)

    const encoded = encodeSnapshot(rgEventBlocks, {
      chainID: 1,
      startHeight: firstBlock,
      endHeight: firstBlock
    })
    await writeSnapshot(out, encoded)
    await writeCarWithArtifactRoot(out, car)

    const bytes = await fs.promises.readFile(car)
    const { CarReader } = await import('@ipld/car')
    const reader = await CarReader.fromBytes(bytes)
    const [root] = await reader.getRoots()

    assert.equal(root!.code, RAW_CODEC)

    // The block stored in the CAR is byte-identical to the artifact and is
    // addressed under the raw codec, so a codec-aware backend imports it
    // without attempting (and failing) to decode it as a structured object.
    const block = await reader.get(root!)
    assert.ok(block)
    assert.equal(Buffer.compare(Buffer.from(block!.bytes), Buffer.from(encoded)), 0)

    cleanup(out, car)
  })
})

test('Snapshot misc scenarios ', async (t) => {
  await t.test('should handle empty block array', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB()
    await db.set('blocks', [])

    const encodedData = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: 17000000n, endHeight: 17000000n })
    await writeSnapshot(out, encodedData)
    const cid = await artifactCIDFromBytes(encodedData)
    const root = await decodeSnapshot(out, cid)

    assert.equal(root.version, 1)
    assert.equal(root.chainID, 1)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })

  await t.test('should handle null/undefined blocks', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB()
    await db.set('blocks', null)

    const encodedData = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: 17000000n, endHeight: 17000000n })
    await writeSnapshot(out, encodedData)
    const cid = await artifactCIDFromBytes(encodedData)

    const root = await decodeSnapshot(out, cid)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })

  await t.test('should handle blocks with empty transactions', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB()

    const data = loadBlockchainEvents()

    const emptyBlock = {
      ...data.blocks[0],
      number: BigInt(data.blocks[0].number),
      timestamp: BigInt(data.blocks[0].timestamp),
      transactions: []
    }
    await db.set('blocks', [emptyBlock])

    const encodedData = await encodeSnapshotFromDB(db, { chainID: 1, startHeight: BigInt(data.blocks[0].number), endHeight: BigInt(data.blocks[0].number) })
    await writeSnapshot(out, encodedData)
    const cid = await artifactCIDFromBytes(encodedData)

    const root = await decodeSnapshot(out, cid)
    assert.equal(root.blocks.length, 1)
    assert.equal(root.blocks[0]!.transactions.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })
})

test('Snapshot encoding determinism', async (t) => {
  await t.test('should produce different CIDs for single block vs multiple blocks', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)

    const encodedData = await encodeSnapshotFromDB(db1, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[0].number })
    const cid1 = await artifactCIDFromBytes(encodedData)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)

    const encodedData2 = await encodeSnapshotFromDB(db2, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(1, rgEventBlocks.length - 1)].number })
    const cid2 = await artifactCIDFromBytes(encodedData2)

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2)
  })

  await t.test('should produce identical CIDs for same block ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')

    const metadata = {
      chainID: 1,
      startHeight: rgEventBlocks[0].number,
      endHeight: rgEventBlocks[Math.min(2, rgEventBlocks.length - 1)].number
    }

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)
    const encodedData1 = await encodeSnapshotFromDB(db1, metadata)
    const cid1 = await artifactCIDFromBytes(encodedData1)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)
    const encodedData2 = await encodeSnapshotFromDB(db2, metadata)
    const cid2 = await artifactCIDFromBytes(encodedData2)

    assert.equal(cid1, cid2)

    cleanup(dbPath1, dbPath2)
  })

  await t.test('should produce different CIDs for shifted ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const dbPath3 = makeTmpPath('db')

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)

    const encoded1 = await encodeSnapshotFromDB(db1, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(2, rgEventBlocks.length - 1)].number })
    const cid1 = await artifactCIDFromBytes(encoded1)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)
    const encoded2 = await encodeSnapshotFromDB(db2, { chainID: 1, startHeight: rgEventBlocks[Math.min(1, rgEventBlocks.length - 1)].number, endHeight: rgEventBlocks[Math.min(3, rgEventBlocks.length - 1)].number })
    const cid2 = await artifactCIDFromBytes(encoded2)

    const db3 = new RailgunDB()
    await db3.set('blocks', rgEventBlocks)
    const encoded3 = await encodeSnapshotFromDB(db3, { chainID: 1, startHeight: rgEventBlocks[Math.min(2, rgEventBlocks.length - 1)].number, endHeight: rgEventBlocks[Math.min(4, rgEventBlocks.length - 1)].number })
    const cid3 = await artifactCIDFromBytes(encoded3)

    assert.notEqual(cid1, cid2)
    assert.notEqual(cid2, cid3)
    assert.notEqual(cid1, cid3)

    cleanup(dbPath1, dbPath2, dbPath3)
  })

  await t.test('should produce different CIDs for overlapping ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)
    const encoded1 = await encodeSnapshotFromDB(db1, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(2, rgEventBlocks.length - 1)].number })
    const cid1 = await artifactCIDFromBytes(encoded1)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)
    const encoded2 = await encodeSnapshotFromDB(db2, { chainID: 1, startHeight: rgEventBlocks[3].number, endHeight: rgEventBlocks[Math.min(8, rgEventBlocks.length - 1)].number })
    const cid2 = await artifactCIDFromBytes(encoded2)

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2)
  })

  await t.test('should produce different CIDs for different range sizes', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const dbPath3 = makeTmpPath('db')

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)
    const encoded1 = await encodeSnapshotFromDB(db1, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(1, rgEventBlocks.length - 1)].number })
    const cid1 = await artifactCIDFromBytes(encoded1)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)
    const encoded2 = await encodeSnapshotFromDB(db2, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(2, rgEventBlocks.length - 1)].number })
    const cid2 = await artifactCIDFromBytes(encoded2)

    const db3 = new RailgunDB()
    await db3.set('blocks', rgEventBlocks)
    const encoded3 = await encodeSnapshotFromDB(db3, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[Math.min(10, rgEventBlocks.length - 1)].number })
    const cid3 = await artifactCIDFromBytes(encoded3)

    assert.notEqual(cid1, cid2)
    assert.notEqual(cid2, cid3)
    assert.notEqual(cid1, cid3)

    cleanup(dbPath1, dbPath2, dbPath3)
  })

  await t.test('should maintain determinism for all available blocks', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB()
    await db1.set('blocks', rgEventBlocks)
    const startTime = Date.now()
    const encoded1 = await encodeSnapshotFromDB(db1, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[rgEventBlocks.length - 1].number })
    const cid1 = await artifactCIDFromBytes(encoded1)
    const duration = Date.now() - startTime

    assert.ok(duration < 10000, `Large range took too long: ${duration}ms`)

    const db2 = new RailgunDB()
    await db2.set('blocks', rgEventBlocks)
    const encoded2 = await encodeSnapshotFromDB(db2, { chainID: 1, startHeight: rgEventBlocks[0].number, endHeight: rgEventBlocks[rgEventBlocks.length - 1].number })
    await writeSnapshot(out1, encoded2)
    const cid2 = await artifactCIDFromBytes(encoded2)

    assert.equal(cid1, cid2)

    const root = await decodeSnapshot(out1, cid2)
    assert.equal(root.blocks.length, rgEventBlocks.length)
    const totalActions = rgEventBlocks.reduce((sum, block) => sum + block.transactions.reduce((txSum: number, tx: any) => txSum + (tx.actions?.flat().length ?? 0), 0), 0)
    assert.equal(root.entryCount, totalActions)
    assert.equal(BigInt(root.startHeight), rgEventBlocks[0].number)
    assert.equal(BigInt(root.endHeight), rgEventBlocks[rgEventBlocks.length - 1].number)

    cleanup(dbPath1, dbPath2, out1)
  })

  await t.test('writeSnapshot and recover it to entries', async () => {
    const dbPath = makeTmpPath('db')
    const outFile = makeTmpPath('snapshot') + '.rsnap'
    const db = new RailgunDB(dbPath)
    await db.set('latestHeight', '16195440n')
    await db.set('blocks', TEST_VECTOR_EVENTS3)

    // Encode snapshot
    const encoded = await encodeSnapshotFromDB(db, {
      chainID: 1,
      startHeight: 15821476n,
      endHeight: 15821513n
    })

    await writeSnapshot(outFile, encoded)
    const cid = await artifactCIDFromBytes(encoded)

    assert.ok(exists(outFile), 'snapshot file should exist')

    const restored = await decodeSnapshot(outFile, cid)
    assert.ok(restored, 'restored object should be defined')

    assert.deepStrictEqual(restored.blocks, TEST_VECTOR_EVENTS3, 'restored object must be same as actual object')

    cleanup(dbPath, outFile)
  })
})

test('Snapshot canonical artifact ordering', async (t) => {
  await t.test('producer canonicalizes blocks and transactions before encoding', async () => {
    const tx1 = makeTransaction(1, [[
      makeSingleCommitmentAction(makeCommitment(0, 0, 10))
    ]], 101)
    const tx2 = makeTransaction(2, [[
      makeCommitmentAction([makeCommitment(0, 1, 11)])
    ]], 102)
    const tx3 = makeTransaction(0, [[
      makeCommitmentAction([makeCommitment(0, 2, 12)])
    ]], 103)

    const block10 = makeBlock(10n, [tx2, tx1], 10)
    const block10Canonical = makeBlock(10n, [tx1, tx2], 10)
    const block11 = makeBlock(11n, [tx3], 11)
    const metadata = {
      chainID: TEST_CHAIN_ID,
      startHeight: 10n,
      endHeight: 11n
    }

    const encodedUnsorted = encodeTestSnapshot([block11, block10], metadata)
    const encodedCanonical = encodeTestSnapshot(
      [block10Canonical, block11],
      metadata
    )
    assert.deepStrictEqual(encodedUnsorted, encodedCanonical)

    const [cidUnsorted, cidCanonical] = await Promise.all([
      artifactCIDFromBytes(encodedUnsorted),
      artifactCIDFromBytes(encodedCanonical)
    ])
    assert.equal(cidUnsorted, cidCanonical)

    const decoded = await decodeArtifact(encodedUnsorted, cidUnsorted)
    assert.deepStrictEqual(
      decoded.blocks.map(block => block.number),
      [10n, 11n]
    )
    assert.deepStrictEqual(
      decoded.blocks[0]!.transactions.map(transaction => transaction.index),
      [1, 2]
    )
    assert.deepStrictEqual(
      collectCommitments(decoded).map(commitment => commitment.treePosition),
      [0, 1, 2]
    )
  })

  await t.test('producer rejects duplicate block numbers and transaction indexes', () => {
    const metadata = {
      chainID: TEST_CHAIN_ID,
      startHeight: 10n,
      endHeight: 11n
    }

    assert.throws(
      () => encodeTestSnapshot([
        makeBlock(10n, [
          makeTransaction(0, [[
            makeCommitmentAction([makeCommitment(0, 0)])
          ]])
        ]),
        makeBlock(10n, [
          makeTransaction(0, [[
            makeCommitmentAction([makeCommitment(0, 1)])
          ]])
        ])
      ], metadata),
      /duplicate block number/
    )

    assert.throws(
      () => encodeTestSnapshot([
        makeBlock(10n, [
          makeTransaction(1, [[
            makeCommitmentAction([makeCommitment(0, 0)])
          ]]),
          makeTransaction(1, [[
            makeCommitmentAction([makeCommitment(0, 1)])
          ]])
        ])
      ], metadata),
      /duplicate transaction index/
    )
  })

  await t.test('producer rejects malformed commitment positions', () => {
    const metadata = {
      chainID: TEST_CHAIN_ID,
      startHeight: 10n,
      endHeight: 10n
    }
    /**
     * Build one block containing the supplied commitments.
     * @param commitments - Commitment entries.
     * @returns Snapshot block.
     */
    const blockWithCommitments = (
      commitments: SnapshotMemoCommitment[]
    ): SnapshotBlock => makeBlock(10n, [
      makeTransaction(0, [[makeCommitmentAction(commitments)]])
    ])

    assert.throws(
      () => encodeTestSnapshot([
        blockWithCommitments([
          makeCommitment(0, 0),
          makeCommitment(0, 0)
        ])
      ], metadata),
      /duplicate commitment position/
    )

    assert.throws(
      () => encodeTestSnapshot([
        blockWithCommitments([
          makeCommitment(0, 1),
          makeCommitment(0, 0)
        ])
      ], metadata),
      /strictly ascending/
    )

    assert.throws(
      () => encodeTestSnapshot([
        blockWithCommitments([
          makeCommitment(0, 0),
          makeCommitment(0, 2)
        ])
      ], metadata),
      /commitment position gap/
    )

    assert.throws(
      () => encodeTestSnapshot([
        blockWithCommitments([
          makeCommitment(0, 0),
          makeCommitment(1, 0)
        ])
      ], metadata),
      /commitment batches cannot cross tree boundaries/
    )
  })

  await t.test('producer enforces cold-start commitment prefix from deployment', () => {
    const deploymentBlock = getNetworkConfigFromChainID(1).deploymentBlock
    const metadata = {
      chainID: 1,
      startHeight: deploymentBlock,
      endHeight: deploymentBlock
    }

    assert.throws(
      () => encodeTestSnapshot([
        makeBlock(deploymentBlock, [
          makeTransaction(0, [[
            makeCommitmentAction([makeCommitment(0, 1)])
          ]])
        ])
      ], metadata),
      /cold-start commitments must start at tree 0 position 0/
    )
  })

  await t.test('decoder rejects noncanonical block and transaction ordering', async () => {
    await assert.rejects(
      () => decodeRawArtifact(makeSnapshot([
        makeBlock(11n),
        makeBlock(10n)
      ], {
        startHeight: 10n,
        endHeight: 11n
      })),
      /blocks must be strictly ascending/
    )

    await assert.rejects(
      () => decodeRawArtifact(makeSnapshot([
        makeBlock(10n),
        makeBlock(10n)
      ])),
      /duplicate block number/
    )

    await assert.rejects(
      () => decodeRawArtifact(makeSnapshot([
        makeBlock(10n, [
          makeTransaction(2, []),
          makeTransaction(1, [])
        ])
      ])),
      /transactions in block 10 must be strictly ascending/
    )

    await assert.rejects(
      () => decodeRawArtifact(makeSnapshot([
        makeBlock(10n, [
          makeTransaction(1, []),
          makeTransaction(1, [])
        ])
      ])),
      /duplicate transaction index/
    )
  })

  await t.test('decoder rejects malformed commitment ordering', async () => {
    /**
     * Build one raw snapshot containing the supplied commitments.
     * @param commitments - Commitment entries.
     * @returns Snapshot root.
     */
    const snapshotWithCommitments = (
      commitments: SnapshotMemoCommitment[]
    ): Snapshot => makeSnapshot([
      makeBlock(10n, [
        makeTransaction(0, [[makeCommitmentAction(commitments)]])
      ])
    ])

    await assert.rejects(
      () => decodeRawArtifact(snapshotWithCommitments([
        makeCommitment(0, 0),
        makeCommitment(0, 0)
      ])),
      /duplicate commitment position/
    )

    await assert.rejects(
      () => decodeRawArtifact(snapshotWithCommitments([
        makeCommitment(0, 1),
        makeCommitment(0, 0)
      ])),
      /strictly ascending/
    )

    await assert.rejects(
      () => decodeRawArtifact(snapshotWithCommitments([
        makeCommitment(0, 0),
        makeCommitment(0, 2)
      ])),
      /commitment position gap/
    )

    await assert.rejects(
      () => decodeRawArtifact(snapshotWithCommitments([
        makeCommitment(0, 0),
        makeCommitment(1, 0)
      ])),
      /commitment batches cannot cross tree boundaries/
    )
  })

  await t.test('valid artifacts preserve action batch and non-commitment action ordering', async () => {
    const block = makeBlock(10n, [
      makeTransaction(0, [
        [
          makeNonCommitmentAction('before-commitment'),
          makeCommitmentAction([makeCommitment(0, 0)], 'first-commitment')
        ],
        [
          makeNonCommitmentAction('between-commitments'),
          makeCommitmentAction([makeCommitment(0, 1)], 'second-commitment')
        ],
        [
          makeNonCommitmentAction('after-commitments')
        ]
      ])
    ])

    const encoded = encodeTestSnapshot([block], {
      chainID: TEST_CHAIN_ID,
      startHeight: 10n,
      endHeight: 10n
    })
    const decoded = await decodeEncodedSnapshot(encoded)
    const actions = decoded.blocks[0]!.transactions[0]!.actions

    assert.deepStrictEqual(
      actions.map(batch => batch.map(action => action['label'])),
      [
        ['before-commitment', 'first-commitment'],
        ['between-commitments', 'second-commitment'],
        ['after-commitments']
      ]
    )
  })

  await t.test('artifact-order commitment application produces expected Merkle root', async () => {
    const commitments = Array.from(
      { length: 8 },
      (_, index) => makeCommitment(0, index, index + 50)
    )
    const block = makeBlock(10n, [
      makeTransaction(0, [
        [makeCommitmentAction(commitments.slice(0, 3))],
        [makeCommitmentAction(commitments.slice(3, 5))],
        [makeCommitmentAction(commitments.slice(5))]
      ])
    ])
    const decoded = await decodeEncodedSnapshot(encodeTestSnapshot([block], {
      chainID: TEST_CHAIN_ID,
      startHeight: 10n,
      endHeight: 10n
    }))

    const artifactOrderLeaves = collectCommitments(decoded).map(commitmentHash)
    const expectedLeaves = commitments.map(commitmentHash)
    assert.deepEqual(artifactOrderLeaves, expectedLeaves)
  })

  await t.test('commitment order remains correct across wallet-sdk-sized block batches', async () => {
    const walletSdkBlockBatchSize = 100
    const blocks = Array.from({ length: walletSdkBlockBatchSize + 1 }, (_, index) => {
      const blockNumber = 1000n + BigInt(index)
      return makeBlock(blockNumber, [
        makeTransaction(0, [[
          makeCommitmentAction([
            makeCommitment(0, index, index + 100)
          ])
        ]], index)
      ], index)
    })

    const decoded = await decodeEncodedSnapshot(encodeTestSnapshot(blocks, {
      chainID: TEST_CHAIN_ID,
      startHeight: blocks[0]!.number,
      endHeight: blocks[blocks.length - 1]!.number
    }))

    const batchAppendedLeaves = appendCommitmentsByBlockBatch(
      decoded,
      walletSdkBlockBatchSize
    )
    const expectedLeaves = Array.from(
      { length: walletSdkBlockBatchSize + 1 },
      (_, index) => commitmentHash(makeCommitment(0, index, index + 100))
    )

    assert.deepEqual(batchAppendedLeaves, expectedLeaves)
  })
})

test('Snapshot error handling', async (t) => {
  await t.test('should handle invalid block range (startHeight > endHeight)', async () => {
    const dbPath = makeTmpPath('db')
    const db = new RailgunDB()
    await db.set('blocks', rgEventBlocks)

    await assert.rejects(
      async () => {
        await encodeSnapshotFromDB(db, {
          chainID: 1,
          startHeight: 99999999n,
          endHeight: 1n
        })
      },
      /Invalid height range/
    )

    cleanup(dbPath)
  })

  await t.test('should reject malformed decoded block data', async () => {
    // Malformed data: missing transactions array
    const malformedBlock = {
      number: 12345n,
      hash: '0xabc',
      timestamp: 1234567890n,
      // transactions: missing
    }

    await assert.rejects(
      () => decodeRawArtifact({
        version: RAW_SNAPSHOT_VERSION,
        chainID: TEST_CHAIN_ID,
        startHeight: 12345n,
        endHeight: 12345n,
        entryCount: 0,
        blocks: [malformedBlock]
      }),
      /block transactions must be an array/
    )
  })

  await t.test('should reject snapshot bytes that do not match the expected CID', async () => {
    const out = makeTmpPath('snap') + '.rsnap'
    const firstBlock = BigInt(rgEventBlocks[0].number)

    const encoded = encodeSnapshot(rgEventBlocks, {
      chainID: 1,
      startHeight: firstBlock,
      endHeight: firstBlock
    })
    const expectedCid = await artifactCIDFromBytes(encoded)
    const tampered = new Uint8Array(encoded)
    tampered[tampered.length - 1]! ^= 0xff

    await writeSnapshot(out, tampered)

    await assert.rejects(
      () => decodeSnapshot(out, expectedCid),
      /Snapshot CID mismatch/
    )

    cleanup(out)
  })

  await t.test('should handle blocks outside requested range', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB()
    await db.set('blocks', rgEventBlocks)

    // Request range that doesn't exist in data
    const encoded = await encodeSnapshotFromDB(db, {
      chainID: 1,
      startHeight: 99999990n,
      endHeight: 99999999n
    })

    const [cid] = await Promise.all([
      artifactCIDFromBytes(encoded),
      writeSnapshot(out, encoded)])

    assert.ok(cid)
    const root = await decodeSnapshot(out, cid)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)
    assert.equal(BigInt(root.startHeight), 99999990n)
    assert.equal(BigInt(root.endHeight), 99999999n)

    cleanup(dbPath, out)
  })
})
