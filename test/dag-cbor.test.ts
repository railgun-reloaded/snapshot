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

hook('setup formats initialization', async () => {
  await initializeFormats()
})

// todo: fetch this data from a mock.json dump
function makeBlock (overrides?: Partial<any>) {
  const base = {
    number: 1000n,
    hash: '0xabc',
    timestamp: 1700000000n,
    transactions: [
      {
        index: 1,
        hash: '0x02',
        from: '0xface',
        // intentionally scrambled log order
        logs: [
          { index: 2, address: '0xdead', name: 'Evt', args: { amount: '0x01', nested: { v: '0x2' } } },
          { index: 1, address: '0xbeef', name: 'Evt', args: { amount: '0x01', nested: { v: '0x02' } } }
        ]
      },
      {
        index: 0,
        hash: '0x01',
        from: '0xcafe',
        logs: [
          { index: 0, address: '0xaaaa', name: 'Start', args: { ok: true } }
        ]
      }
    ],
    internalTransaction: []
  }
  return { ...base, ...(overrides ?? {}) }
}

function makeBlockRange (startNum: number, count: number) {
  return Array.from({ length: count }, (_, i) => makeBlock({
    number: BigInt(startNum + i),
    hash: `0x${(startNum + i).toString(16).padStart(64, '0')}`,
    timestamp: BigInt(1700000000 + i * 12), // 12 second blocks
    transactions: [
      {
        index: 0,
        hash: `0x${(startNum + i + 100).toString(16).padStart(64, '0')}`,
        from: `0x${(startNum + i).toString(16).padStart(40, '0')}`,
        logs: [
          {
            index: 0,
            address: `0x${(startNum + i + 200).toString(16).padStart(40, '0')}`,
            name: 'BlockEvent',
            args: { blockNum: `0x${(startNum + i).toString(16)}` }
          }
        ]
      }
    ]
  }))
}

test('Snapshot basic encoding', async (t) => {
  t.test('should return CID and computeDagCborCID(out) should match', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)
    await db.set('events', [makeBlock()])

    const cid = await encodeSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
    const verify = await computeDagCborCID(out)
    assert.equal(verify, cid)

    const root = await decodeSnapshot(out)
    assert.equal(root.version, 1)
    assert.equal(root.chainID, 1)
    assert.equal(BigInt(root.startHeight), 1000n)
    assert.equal(BigInt(root.endHeight), 1000n)
    assert.equal(root.blocks.length, 1)
    // 3 logs total across txs
    assert.equal(root.entryCount, 3)

    cleanup(dbPath, out)
  })

  t.test('should produce identical CID for different tx/log orders (canonicalization)', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    // Variant A: tx order [1,0], logs in tx[1] scrambled 2,1
    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', [makeBlock()])

    // Variant B: tx order [0,1], logs in tx[1] canonical 1,2
    const blockB = makeBlock({
      transactions: [
        {
          index: 0,
          hash: '0x01',
          from: '0xcafe',
          logs: [
            { index: 0, address: '0xaaaa', name: 'Start', args: { ok: true } }
          ]
        },
        {
          index: 1,
          hash: '0x02',
          from: '0xface',
          logs: [
            { index: 1, address: '0xbeef', name: 'Evt', args: { amount: '0x01', nested: { v: '0x02' } } },
            { index: 2, address: '0xdead', name: 'Evt', args: { amount: '0x01', nested: { v: '0x2' } } }
          ]
        }
      ]
    })
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', [blockB])

    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
    assert.equal(cid1, cid2)

    const [verify1, verify2] = await Promise.all([computeDagCborCID(out1), computeDagCborCID(out2)])
    assert.equal(verify1, verify2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce different CID for minimal mutations', async () => {
    const dbPath = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)

    const base = makeBlock()
    await db.set('events', [base])
    const cid1 = await encodeSnapshot(db, out1, { chainID: 1, startHeight: 1000n, endHeight: 1000n })

    // Mutate: change one arg hex (normalized form stays even-length lower-case)
    const mutated: any = makeBlock()
    mutated.transactions[0].logs[0].args.amount = '0x03'
    await db.set('events', [mutated])
    const cid2 = await encodeSnapshot(db, out2, { chainID: 1, startHeight: 1000n, endHeight: 1000n })

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

    await db.set('events', [makeBlock()])
    await encodeSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
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

    const cid = await encodeSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
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

    await encodeSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
    const root = await decodeSnapshot(out)
    assert.equal(root.blocks.length, 0)
    assert.equal(root.entryCount, 0)

    cleanup(dbPath, out)
  })

  t.test('should handle blocks with empty transactions', async () => {
    const dbPath = makeTmpPath('db')
    const out = makeTmpPath('snap') + '.rsnap'
    const db = new RailgunDB(dbPath)

    const emptyBlock = makeBlock({ transactions: [] })
    await db.set('events', [emptyBlock])

    await encodeSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
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

    // Single block 1000
    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', makeBlockRange(1000, 1))
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1000n })

    // Two blocks 1000-1001
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', makeBlockRange(1000, 2))
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1000n, endHeight: 1001n })

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce identical CIDs for same block ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    // Same range 1000-1002 created twice
    const blocks = makeBlockRange(1000, 3)

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', blocks)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1002n })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', blocks)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1000n, endHeight: 1002n })

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

    // Range 1000-1002
    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', makeBlockRange(1000, 3))
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1002n })

    // Range 1001-1003
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', makeBlockRange(1001, 3))
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1001n, endHeight: 1003n })

    // Range 1002-1004
    const db3 = new RailgunDB(dbPath3)
    await db3.set('events', makeBlockRange(1002, 3))
    const cid3 = await encodeSnapshot(db3, out3, { chainID: 1, startHeight: 1002n, endHeight: 1004n })

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

    // Range 1000-1005 (6 blocks)
    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', makeBlockRange(1000, 6))
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1005n })

    // Range 1003-1008 (6 blocks, 3 block overlap)
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', makeBlockRange(1003, 6))
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1003n, endHeight: 1008n })

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

    // Same starting block, different range sizes
    const startBlock = 1000

    // Range 1000-1001 (2 blocks)
    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', makeBlockRange(startBlock, 2))
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1001n })

    // Range 1000-1002 (3 blocks)
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', makeBlockRange(startBlock, 3))
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 1000n, endHeight: 1002n })

    // Range 1000-1010 (11 blocks)
    const db3 = new RailgunDB(dbPath3)
    await db3.set('events', makeBlockRange(startBlock, 11))
    const cid3 = await encodeSnapshot(db3, out3, { chainID: 1, startHeight: 1000n, endHeight: 1010n })

    assert.notEqual(cid1, cid2)
    assert.notEqual(cid2, cid3)
    assert.notEqual(cid1, cid3)

    cleanup(dbPath1, dbPath2, dbPath3, out1, out2, out3)
  })

  t.test('should maintain determinism for large block ranges', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    // Create 100 consecutive blocks
    const largeRange = makeBlockRange(5000, 100)

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', largeRange)
    const startTime = Date.now()
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 5000n, endHeight: 5099n })
    const duration = Date.now() - startTime

    // Should complete within reasonable time
    assert.ok(duration < 10000, `Large range took too long: ${duration}ms`)

    // Verify determinism with same data
    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', largeRange)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 1, startHeight: 5000n, endHeight: 5099n })

    assert.equal(cid1, cid2)

    // Verify snapshot structure
    const root = await decodeSnapshot(out1)
    assert.equal(root.blocks.length, 100)
    assert.equal(root.entryCount, 100) // 1 log per block
    assert.equal(BigInt(root.startHeight), 5000n)
    assert.equal(BigInt(root.endHeight), 5099n)

    cleanup(dbPath1, dbPath2, out1, out2)
  })

  t.test('should produce different CIDs for different chainIDs', async () => {
    const dbPath1 = makeTmpPath('db')
    const dbPath2 = makeTmpPath('db')
    const out1 = makeTmpPath('snap') + '.rsnap'
    const out2 = makeTmpPath('snap') + '.rsnap'

    const blocks = makeBlockRange(1000, 5)

    const db1 = new RailgunDB(dbPath1)
    await db1.set('events', blocks)
    const cid1 = await encodeSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1004n })

    const db2 = new RailgunDB(dbPath2)
    await db2.set('events', blocks)
    const cid2 = await encodeSnapshot(db2, out2, { chainID: 137, startHeight: 1000n, endHeight: 1004n })

    assert.notEqual(cid1, cid2)

    cleanup(dbPath1, dbPath2, out1, out2)
  })
})
