import assert from 'node:assert/strict'
import fs from 'node:fs'

import { test } from 'brittle'
// @ts-ignore - hook not in type definitions but exists in 3.19.0
const { hook } = require('brittle')

import { RailgunDB } from '../src/database'
import { initializeFormats } from '../src/formats'
import { computeDagCborCID, writeCarWithDagCborRoot } from '../src/ipfs'
import { decodeSnapshot, encodeSnapshot } from '../src/snapshot/snapshot'

import { cleanup, makeTmpPath } from './utils'
import { loadBlockchainEvents } from './fixtures'

let rgEvents: any[] = []

hook('setup formats initialization', async () => {
  await initializeFormats()
})

hook('setup railgun events on db', async () => {
  const data = loadBlockchainEvents()
  rgEvents = data.blocks.map(block => ({
    ...block,
    number: BigInt(block.number),
    timestamp: BigInt(block.timestamp)
  }))
})

test('Snapshot basic encoding', async (t) => {
  t.test('should return CID and computeDagCborCID(out) should match', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)

    await db.set('events', rgEvents)

    const firstBlock = rgEvents[0].number
    const cid = await encodeSnapshot(db, out, { chainID: 1, startHeight: firstBlock, endHeight: firstBlock })
    const verify = await computeDagCborCID(out)
    assert.equal(verify, cid)

    const root = await decodeSnapshot(out)
    assert.equal(root.version, 1)
    assert.equal(root.chainID, 1)
    assert.equal(BigInt(root.startHeight), firstBlock)
    assert.equal(BigInt(root.endHeight), firstBlock)
    assert.equal(root.blocks.length, 1)
    const expectedEvents = rgEvents[0].transactions.reduce((sum: number, tx: any) => sum + tx.logs.length, 0)
    assert.equal(root.entryCount, expectedEvents)

    cleanup(dbPath, out)
  })

  t.test('should produce identical CID for identical real blockchain data', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)

    const blockNumber = rgEvents[0].number
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: blockNumber, endHeight: blockNumber })
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: blockNumber, endHeight: blockNumber })
    assert.equal(cid1, cid2)

    const [verify1, verify2] = await Promise.all([computeDagCborCID(out1), computeDagCborCID(out2)])
    assert.equal(verify1, verify2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce different CID for different real blocks', async () => {
    const dbPath = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)

    // Store all events in database, then snapshot different ranges
    await db.set('events', rgEvents)

    const cid1 = await encodeSnapshot(db, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[0].number })
    const cid2 = await encodeSnapshot(db, out2, { chainID: 1, startHeight: rgEvents[1].number, endHeight: rgEvents[1].number })

    assert.notEqual(cid1, cid2)

    cleanup(dbPath, out1, out2)
  })
})

test('Snapshot .CAR Integration', async (t) => {
  t.test('should have root CID matching encoded file CID', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const car = makeTmpPath('car') + '.car'
    const db = new RailgunDB(dbPath)

    const data = loadBlockchainEvents()
    const firstBlock = {
      ...data.blocks[0],
      number: BigInt(data.blocks[0].number),
      timestamp: BigInt(data.blocks[0].timestamp)
    }

    await db.set('events', [firstBlock])
    await encodeSnapshot(db, out, { chainID: 1, startHeight: BigInt(data.blocks[0].number), endHeight: BigInt(data.blocks[0].number) })
    const cid = await computeDagCborCID(out)
    await writeCarWithDagCborRoot(out, car)

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

test('Snapshot misc scenarios ', async (t) => {
  t.test('should handle empty events array', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)
    await db.set('events', [])

    const cid = await encodeSnapshot(db, out, { chainID: 1, startHeight: 17000000n, endHeight: 17000000n })
    const verify = await computeDagCborCID(out)
    assert.equal(verify, cid)

    const root = await decodeSnapshot(out)
    assert.equal(root.version, 1)
    assert.equal(root.chainID, 1)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })

  t.test('should handle null/undefined events', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)
    await db.set('events', null)

    await encodeSnapshot(db, out, { chainID: 1, startHeight: 17000000n, endHeight: 17000000n })
    const root = await decodeSnapshot(out)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })

  t.test('should handle blocks with empty transactions', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)

    const data = loadBlockchainEvents()
    const emptyBlock = {
      ...data.blocks[0],
      number: BigInt(data.blocks[0].number),
      timestamp: BigInt(data.blocks[0].timestamp),
      transactions: []
    }
    await db.set('events', [emptyBlock])

    await encodeSnapshot(db, out, { chainID: 1, startHeight: BigInt(data.blocks[0].number), endHeight: BigInt(data.blocks[0].number) })
    const root = await decodeSnapshot(out)
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
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[0].number })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[1].number })

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce identical CIDs for same block ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[2].number })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[2].number })

    assert.equal(cid1, cid2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce different CIDs for shifted ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const dbPath3 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'
    const out3 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[2].number })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[1].number, endHeight: rgEvents[3].number })

    const db3 = new RailgunDB(dbPath3)
    await db3.set('events', rgEvents)
    const cid3 = await encodeSnapshot(db3, out3, { chainID: 1, startHeight: rgEvents[2].number, endHeight: rgEvents[4].number })

    assert.notEqual(cid1, cid2)
    assert.notEqual(cid2, cid3)
    assert.notEqual(cid1, cid3)

    cleanup(dbPath1, dbPath2, dbPath3, out1, out2, out3)
  })

  t.test('should produce different CIDs for overlapping ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[2].number })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[3].number, endHeight: rgEvents[8].number })

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce different CIDs for different range sizes', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const dbPath3 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'
    const out3 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[1].number })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[2].number })

    const db3 = new RailgunDB(dbPath3)
    await db3.set('events', rgEvents)
    const cid3 = await encodeSnapshot(db3, out3, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[10].number })

    assert.notEqual(cid1, cid2)
    assert.notEqual(cid2, cid3)
    assert.notEqual(cid1, cid3)

    cleanup(dbPath1, dbPath2, dbPath3, out1, out2, out3)
  })

  t.test('should maintain determinism for all available blocks', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', rgEvents)
    const startTime = Date.now()
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[rgEvents.length - 1].number })
    const duration = Date.now() - startTime

    assert.ok(duration < 10000, `Large range took too long: ${duration}ms`)

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', rgEvents)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: rgEvents[0].number, endHeight: rgEvents[rgEvents.length - 1].number })

    assert.equal(cid1, cid2)

    const root = await decodeSnapshot(out1)
    assert.equal(root.blocks.length, rgEvents.length)
    const totalEvents = rgEvents.reduce((sum, block) => sum + block.transactions.reduce((txSum: number, tx: any) => txSum + tx.logs.length, 0), 0)
    assert.equal(root.entryCount, totalEvents)
    assert.equal(BigInt(root.startHeight), rgEvents[0].number)
    assert.equal(BigInt(root.endHeight), rgEvents[rgEvents.length - 1].number)

    cleanup(dbPath1, dbPath2, out1, out2)
  })
})
