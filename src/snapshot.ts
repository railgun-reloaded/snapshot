import fs from 'fs'
import * as zlib from 'zlib'

import { decode, encode } from '@msgpack/msgpack'

import type { RailgunDB } from './database'

/**
 * Create snapshot from RailgunDB Instance
 * @param railgunDB - Railgun DB Instance
 * @param filename - Output snapshot filename
 */
async function createSnapshotFromDB (railgunDB: RailgunDB, filename = 'snapshot.gz') {
  const outFile = fs.createWriteStream(filename)
  const zip = zlib.createGzip()
  zip.pipe(outFile)

  const levelDB = railgunDB.levelDB
  for await (const [key, val] of levelDB.iterator()) {
    const entry = encode([key, val])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(entry.length, 0)
    zip.write(len)
    zip.write(entry)
  }
  zip.end()
  await new Promise(resolve => zip.on('end', resolve))
}

/**
 * Restore snapshot from the file
 * @param filename - Snapshot file name
 * @returns Key value pair stored in the snapshot
 */
async function restoreSnapshot (filename = 'snapshot.gz') {
  if (!fs.existsSync(filename)) {
    throw new Error("File doesn't exists")
  }

  const stream = fs.createReadStream(filename).pipe(zlib.createGunzip())
  let buffer = Buffer.alloc(0)
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
      })
      stream.on('end', () => resolve())
      stream.on('error', (err) => reject(err))
    })

    const result : Record<string, any> = {}
    while (buffer.length > 0) {
      const len = buffer.readUInt32BE(0)
      const payload = buffer.slice(4, 4 + len)

      const [key, val] = decode(payload) as [string, string]
      result[key] = JSON.parse(val)

      buffer = buffer.slice(4 + len)
    }
    return result
  } catch (err) {
    console.log('Failed to read snasphot', err)
  }
  return undefined
}

export { createSnapshotFromDB, restoreSnapshot }
