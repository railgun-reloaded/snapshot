import fs from 'fs'
import * as zlib from 'zlib'

import { encode } from '@msgpack/msgpack'
import { ClassicLevel } from 'classic-level'

type Serializable = string | number | boolean | object | null

/**
 * Railgun Database Instance
 */
class SnapshotDB {
  /**
   * Name of Database
   */
  dbName: string

  /**
   * Instance of ClassicLevel Database
   */
  db: ClassicLevel

  /**
   * Initialize Railgun Event Database
   * @param dbName - Name of Database
   */
  constructor (dbName: string) {
    this.dbName = dbName
    this.db = new ClassicLevel(dbName)
  }

  /**
   * Set the entry in the database
   * @param key - Key to set
   * @param values - Values for given key
   */
  async set (key: string, values: Serializable) {
    await this.db.put(key, JSON.stringify(values, (_, v) => typeof (v) === 'bigint' ? v.toString() : v))
  }

  /**
   * Get the value for given key
   * @param key - Key to get from DB
   * @returns - Values for given key
   */
  async get<T=Serializable>(key: string) {
    try {
      const values = await this.db.get(key)
      if (values) { return JSON.parse(values) as T }
    } catch {
      console.log("Couldn't find key: ", key)
    }
    return null
  }

  /**
   * Create snapshot of DB
   * @param filename - Output snapshot filename
   */
  async createSnapshot (filename = 'snapshot.gz') {
    const outFile = fs.createWriteStream(filename)
    const zip = zlib.createGzip()
    zip.pipe(outFile)

    for await (const [key, val] of this.db.iterator()) {
      const entry = encode([key, val])
      const len = Buffer.alloc(4, entry.length)
      zip.write(len)
      zip.write(entry)
    }
  }
}

export { SnapshotDB }
