import assert from 'node:assert/strict'
import fs from 'node:fs'

import { test } from 'brittle'

import { computeRawCID, validateFileCID, writeCarWithRoot } from '../src/lib/content/index.js'

import { cleanup, makeTmpPath, writeFile } from './utils.js'

test('computeRawCID deterministic for identical bytes', async () => {
  const p1 = makeTmpPath('blob') + '/file.bin'
  const p2 = makeTmpPath('blob') + '/file.bin'
  const data = Buffer.from('railgun-snapshot')
  writeFile(p1, data)
  writeFile(p2, data)

  const [c1, c2] = await Promise.all([computeRawCID(p1), computeRawCID(p2)])
  assert.equal(c1, c2)

  cleanup(p1, p2)
})

test('validateFileCID returns true for matching CID and false otherwise', async () => {
  const p = makeTmpPath('blob') + '/file.bin'
  writeFile(p, Buffer.from('railgun-cid-check'))

  const cid = await computeRawCID(p)
  assert.ok(await validateFileCID(p, cid))
  assert.equal(await validateFileCID(p, cid.replace(/.$/, 'a')), false)

  cleanup(p)
})

test('computeRawCID differs when content differs by one byte', async () => {
  const p1 = makeTmpPath('blob') + '/file1.bin'
  const p2 = makeTmpPath('blob') + '/file2.bin'
  writeFile(p1, Buffer.from('x'))
  writeFile(p2, Buffer.from('y'))

  const [c1, c2] = await Promise.all([computeRawCID(p1), computeRawCID(p2)])
  assert.notEqual(c1, c2)

  cleanup(p1, p2)
})

test('writeCarWithRoot produces CAR with root matching raw CID', async () => {
  const p = makeTmpPath('blob') + '/file.bin'
  const car = makeTmpPath('car') + '/archive.car'
  writeFile(p, Buffer.from('railgun-car'))
  const cid = await computeRawCID(p)
  await writeCarWithRoot(p, car)
  const bytes = await fs.promises.readFile(car)
  const { CarReader } = await import('@ipld/car')
  const reader = await CarReader.fromBytes(bytes)
  const roots = await reader.getRoots()
  assert.ok(roots.length > 0)
  const rootStr = roots[0]!.toString()
  assert.equal(rootStr, cid)
  cleanup(p, car)
})
