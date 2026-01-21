// import path from 'node:path'

import { test } from 'brittle'

import { decodeSnapshot, initializeFormats, writeSnapshot } from '../src'
import { RailgunDB } from '../src/lib/database'

import { TEST_VECTOR_EVENTS2, TEST_VECTOR_EVENTS3 } from './test-vectors'
import { cleanup, exists, makeTmpPath, writeFile, /* writeFile */ } from './utils'

// @ts-ignore - hook not in type definitions but exists in 3.19.0
const { hook } = require('brittle')

hook('setup formats initialization', async () => {
  await initializeFormats()
})

test('writeSnapshot and restore it', async (assert) => {
  const dbPath = makeTmpPath('db')
  const outFile = makeTmpPath('snapshot') + '.rsnap'
  const db = new RailgunDB(dbPath)
  await db.set('latestHeight', '16195440n')

  await db.set('events', TEST_VECTOR_EVENTS2)

  // Encode snapshot
  await writeSnapshot(db, outFile, {
    chainID: 1,
    startHeight: 16195440n,
    endHeight: 16195440n
  })

  assert.ok(exists(outFile), 'snapshot file should exist')

  const restored = await decodeSnapshot(outFile)
  assert.ok(restored, 'restored object should be defined')

  cleanup(dbPath, outFile)
})

test('writeSnapshot and recover it to entries', async (assert) => {
  const dbPath = makeTmpPath('db')
  const outFile = makeTmpPath('snapshot') + '.rsnap'
  const db = new RailgunDB(dbPath)
  await db.set('latestHeight', '16195440n')

  await db.set('events', TEST_VECTOR_EVENTS3)

  // Encode snapshot
  await writeSnapshot(db, outFile, {
    chainID: 1,
    startHeight: 15821476n,
    endHeight: 15821513n
  })

  assert.ok(exists(outFile), 'snapshot file should exist')

  const restored = await decodeSnapshot(outFile)
  assert.ok(restored, 'restored object should be defined')

  assert.alike.coercively(TEST_VECTOR_EVENTS3, restored.blocks, 'restored object must be same as actual object')

  cleanup(dbPath, outFile)
})

test('restoreSnapshot throws for missing file', async (assert) => {
  const missing = makeTmpPath('no-file') + '.rsnap'
  let threw = false
  try {
    await decodeSnapshot(missing)
  } catch (err: any) {
    threw = true
  } finally {
    assert.ok(threw, 'expected restoreSnapshot to throw for missing file')
    cleanup(missing)
  }
})

test('restoreSnapshot returns undefined for corrupted file', async (assert) => {
  const badFile = makeTmpPath('corrupted') + '.rsnap'
  const garbage = Buffer.from('not-a-valid-snapshot')
  writeFile(badFile, garbage)

  let threw = false
  try {
    await decodeSnapshot(badFile)
  } catch (err) {
    threw = true
  } finally {
    assert.ok(threw, 'expected restoreSnapshot to throw for corroupted file')
    cleanup(badFile)
  }
})
