import assert from 'node:assert/strict'
import fs from 'node:fs'

import { test } from 'brittle'

import { RailgunDB } from '../src/database.js'
import { writeDagCborSnapshot, readDagCborSnapshot } from '../src/snapshot.js'
import { computeDagCborCID, writeCarWithDagCborRoot } from '../src/ipfs.js'

import { cleanup, makeTmpPath } from './utils.js'

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

test('writeDagCborSnapshot returns CID and computeDagCborCID(out) matches', async () => {
  const dbPath = makeTmpPath('db')
  const out = makeTmpPath('snap') + '.rsnap'
  const db = new RailgunDB(dbPath)
  await db.set('events', [makeBlock()])

  const cid = await writeDagCborSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
  const verify = await computeDagCborCID(out)
  assert.equal(verify, cid)

  const root = await readDagCborSnapshot(out)
  assert.equal(root.version, 1)
  assert.equal(root.chainID, 1)
  assert.equal(BigInt(root.startHeight), 1000n)
  assert.equal(BigInt(root.endHeight), 1000n)
  assert.equal(root.blocks.length, 1)
  // 3 logs total across txs
  assert.equal(root.entryCount, 3)

  cleanup(dbPath, out)
})

test('canonicalization: different tx/log orders yield identical CID', async () => {
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

  const cid1 = await writeDagCborSnapshot(db1, out1, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
  const cid2 = await writeDagCborSnapshot(db2, out2, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
  assert.equal(cid1, cid2)

  const [verify1, verify2] = await Promise.all([computeDagCborCID(out1), computeDagCborCID(out2)])
  assert.equal(verify1, verify2)

  cleanup(dbPath1, dbPath2, out1, out2)
})

test('negative: minimal mutation changes CID', async () => {
  const dbPath = makeTmpPath('db')
  const out1 = makeTmpPath('snap') + '.rsnap'
  const out2 = makeTmpPath('snap') + '.rsnap'
  const db = new RailgunDB(dbPath)

  const base = makeBlock()
  await db.set('events', [base])
  const cid1 = await writeDagCborSnapshot(db, out1, { chainID: 1, startHeight: 1000n, endHeight: 1000n })

  // Mutate: change one arg hex (normalized form stays even-length lower-case)
  const mutated: any = makeBlock()
  mutated.transactions[0].logs[0].args.amount = '0x03'
  await db.set('events', [mutated])
  const cid2 = await writeDagCborSnapshot(db, out2, { chainID: 1, startHeight: 1000n, endHeight: 1000n })

  assert.notEqual(cid1, cid2)

  cleanup(dbPath, out1, out2)
})

test('CAR: root matches DAG-CBOR CID', async () => {
  const dbPath = makeTmpPath('db')
  const out = makeTmpPath('snap') + '.rsnap'
  const car = makeTmpPath('car') + '.car'
  const db = new RailgunDB(dbPath)

  await db.set('events', [makeBlock()])
  await writeDagCborSnapshot(db, out, { chainID: 1, startHeight: 1000n, endHeight: 1000n })
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
