import assert from 'node:assert/strict'
import fs from 'node:fs'

// @ts-ignore - hook not in type definitions but exists in 3.19.0
import { hook, test } from 'brittle'

import { artifactCIDFromBytes, computeArtifactCID, writeCarWithArtifactRoot } from '../src/lib/content/index.js'
import { RailgunDB } from '../src/lib/database/index.js'
import { CID } from '../src/lib/formats/index.js'
import { decodeSnapshot, encodeSnapshot, encodeSnapshotFromDB, writeSnapshot } from '../src/snapshot/core.js'
import { DAGCBORCodec } from '../src/snapshot/dagcbor-codec.js'

import { loadBlockchainEvents } from './fixtures/index.js'
import { TEST_VECTOR_EVENTS3 } from './test-vectors.js'
import { cleanup, exists, makeTmpPath } from './utils.js'

let rgEventBlocks: any[] = []

hook('setup railgun blocks on db', async () => {
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
  t.test('should produce same cid from bytes and snapshot file', async () => {
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

  t.test('should produce identical CID for identical real blockchain data', async () => {
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

  t.test('should produce different CID for different real blocks', async () => {
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
  t.test('should have root CID matching encoded file CID', async () => {
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

  t.test('artifact CID uses the raw codec', async () => {
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

  t.test('CAR root codec matches the encoded bytes (raw)', async () => {
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
  t.test('should handle empty block array', async () => {
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

  t.test('should handle null/undefined blocks', async () => {
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

  t.test('should handle blocks with empty transactions', async () => {
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
  t.test('should produce different CIDs for single block vs multiple blocks', async () => {
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

  t.test('should produce identical CIDs for same block ranges', async () => {
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

  t.test('should produce different CIDs for shifted ranges', async () => {
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

  t.test('should produce different CIDs for overlapping ranges', async () => {
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

  t.test('should produce different CIDs for different range sizes', async () => {
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

  t.test('should maintain determinism for all available blocks', async () => {
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

  test('writeSnapshot and recover it to entries', async (assert) => {
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

    assert.alike.coercively(TEST_VECTOR_EVENTS3, restored.blocks, 'restored object must be same as actual object')

    cleanup(dbPath, outFile)
  })
})

test('Snapshot error handling', async (t) => {
  t.test('should handle invalid block range (startHeight > endHeight)', async () => {
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

  t.test('should reject malformed decoded block data', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB()

    // Malformed data: missing transactions array
    const malformedBlock = {
      number: 12345,
      hash: '0xabc',
      timestamp: 1234567890,
      // transactions: missing
    }

    await db.set('blocks', [malformedBlock])

    const encoded = await encodeSnapshotFromDB(db, {
      chainID: 1,
      startHeight: 12345n,
      endHeight: 12345n
    })

    await writeSnapshot(out, encoded)
    const cid = await computeArtifactCID(out)

    assert.ok(cid)
    await assert.rejects(
      () => decodeSnapshot(out, cid),
      /block transactions must be an array/
    )

    cleanup(dbPath, out)
  })

  t.test('should reject snapshot bytes that do not match the expected CID', async () => {
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

  t.test('should handle blocks outside requested range', async () => {
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
