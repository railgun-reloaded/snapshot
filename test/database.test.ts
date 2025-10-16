import { test } from 'brittle'
import assert from 'node:assert/strict'
import { makeTmpPath, cleanup } from './utils'
import { RailgunDB } from '../src/database'

test('RailgunDB set/get stores JSON and stringifies bigint', async () => {
  const dbPath = makeTmpPath('db')
  const db = new RailgunDB(dbPath)

  const input = { a: 1, b: 'x', big: 42n, nested: { ok: true } }
  await db.set('key', input)
  const got = await db.get('key') as any

  assert.equal(got.a, 1)
  assert.equal(got.b, 'x')
  assert.equal(got.big, '42') // bigint serialized to string
  assert.deepEqual(got.nested, { ok: true })

  const missing = await db.get('missing')
  assert.equal(missing, null)

  cleanup(dbPath)
})
