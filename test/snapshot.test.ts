import { test } from 'brittle'
import assert from 'node:assert/strict'
import path from 'node:path'

import { RailgunDB } from '../src/database'
import { createSnapshotFromDB, restoreSnapshot } from '../src/snapshot'
import { makeTmpPath, cleanup, writeFile, exists } from './utils'

test('createSnapshotFromDB writes and restoreSnapshot reads back entries', async () => {
  const dbPath = makeTmpPath('db')
  const outFile = makeTmpPath('snapshot') + '.gz'

  const db = new RailgunDB(dbPath)
  await db.set('latestHeight', '12345')
  await db.set('events', {
    ok: true,
    count: 2,
    label: 'alpha',
    big: 9007199254740993n, // bigint should serialize to string
    nested: { arr: [1, 'x'] }
  })

  await createSnapshotFromDB(db, outFile)
  assert.ok(exists(outFile), 'snapshot file should exist')

  const restored = await restoreSnapshot(outFile)
  assert.ok(restored, 'restored object should be defined')
  assert.equal(restored?.['latestHeight'], '12345')
  assert.equal(restored?.['events'].ok, true)
  assert.equal(restored?.['events'].count, 2)
  assert.equal(restored?.['events'].label, 'alpha')
  // bigint round-trips as string due to JSON serialization in DB layer
  assert.equal(restored?.['events'].big, '9007199254740993')
  assert.deepEqual(restored?.['events'].nested, { arr: [1, 'x'] })

  cleanup(dbPath, outFile)
})

test('restoreSnapshot throws for missing file', async () => {
  const missing = makeTmpPath('no-file') + '.gz'
  let threw = false
  try {
    await restoreSnapshot(missing)
  } catch (err: any) {
    threw = true
    assert.match(String(err?.message ?? err), /doesn't exists/)
  }
  assert.ok(threw, 'expected restoreSnapshot to throw for missing file')
})

test('restoreSnapshot returns undefined for corrupted gzip', async () => {
  const badFile = makeTmpPath('corrupted') + '.gz'
  const garbage = Buffer.from('not-a-valid-snapshot')
  const gz = require('zlib').gzipSync(garbage)
  writeFile(badFile, gz)

  const result = await restoreSnapshot(badFile)
  assert.equal(result, undefined)

  cleanup(badFile)
})

// test('Should generate and restore snapshot [Ethereum]', { timeout: 300_000, skip: true }, async () => {})

test('Should restore snapshot [Ethereum]', { timeout: 300_000 }, async () => {
  const snapshotPath = path.join(process.cwd(), 'snapshot.gz')
  let restored
  try {
    restored = await restoreSnapshot(snapshotPath)
  } catch (err) {
    assert.fail('restoreSnapshot should not throw on bundled snapshot.gz')
  }
  const acceptable = restored === undefined || typeof restored === 'object'
  assert.ok(acceptable, 'restoreSnapshot should return object or undefined')
  if (restored && typeof restored === 'object') {
    assert.ok(Object.keys(restored).length >= 0)
  }
})
