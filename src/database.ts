import { ClassicLevel } from 'classic-level'
import fs from 'node:fs/promises'
import path from 'node:path'

type Serializable = string | number | boolean | object | null

/**
 * Railgun Database Instance
 */
type Backend = {
  put: (key: string, value: string) => Promise<void>
  get: (key: string) => Promise<string | null>
  iterator: () => AsyncIterable<[string, string]>
  close?: () => Promise<void>
  raw?: any
}

class RailgunDB {
  /**
   * Name of Database
   */
  #dbName: string

  /**
   * Instance of ClassicLevel Database
   */
  #db: Backend

  /**
   * Initialize Railgun Event Database
   * @param dbName - Name of Database
   */
  constructor (dbName: string, opts?: { backend?: 'level' | 'file' }) {
    this.#dbName = dbName
    const backend = opts?.backend ?? ((process.env as Record<string, any>)["SNAPSHOT_DB_BACKEND"] as 'level' | 'file' | undefined) ?? 'level'
    if (backend === 'file') {
      this.#db = createFileBackend(this.#dbName)
    } else {
      const level = new ClassicLevel(this.#dbName, { valueEncoding: 'utf8' } as any)
      this.#db = {
        put: async (k, v) => level.put(k, v),
        get: async (k) => {
          try { return await level.get(k) as string } catch { return null }
        },
        iterator: async function * () {
          for await (const [k, v] of (level as any).iterator()) {
            const vs = typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('utf8')
            yield [k as string, vs]
          }
        },
        close: async () => { try { await (level as any).close?.() } catch {} },
        raw: level
      }
    }
  }

  /**
   * Set the entry in the database
   * @param key - Key to set
   * @param values - Values for given key
   */
  async set (key: string, values: Serializable) {
    await this.#db.put(key, JSON.stringify(values, (_, v) => typeof (v) === 'bigint' ? v.toString() : v))
  }

  /**
   * Get the value for given key
   * @param key - Key to get from DB
   * @returns - Values for given key
   */
  async get<T=Serializable>(key: string) {
    try {
      const str = await this.#db.get(key)
      if (str) { return JSON.parse(str) as T }
    } catch {
      console.log("Couldn't find key: ", key)
    }
    return null
  }

  /**
   * Get levelDB instance
   * @returns LevelDB Instance
   */
  get levelDB () {
    return (this.#db as any).raw ?? this.#db
  }

  /**
   * Generic async entries iterator across backends
   */
  async * entries (): AsyncIterable<[string, string]> {
    yield * this.#db.iterator()
  }
}

export { RailgunDB }
export type { Serializable }

// Simple file-backed backend as placeholder: stores a flat JSON object { key: stringJSON }
function createFileBackend (dbPath: string): Backend {
  const dataFile = path.extname(dbPath) ? dbPath : path.join(dbPath)
  let cache: Record<string, string> = {}
  const load = async () => {
    try {
      const s = await fs.readFile(dataFile, 'utf8')
      cache = s ? JSON.parse(s) : {}
    } catch {
      cache = {}
    }
  }
  const persist = async () => {
    await fs.mkdir(path.dirname(dataFile), { recursive: true }).catch(() => {})
    await fs.writeFile(dataFile, JSON.stringify(cache))
  }
  // Initialize lazily upon first access
  let inited = false
  const ensure = async () => { if (!inited) { await load(); inited = true } }
  return {
    put: async (k, v) => { await ensure(); cache[k] = v; await persist() },
    get: async (k) => { await ensure(); return cache[k] ?? null },
    iterator: async function * () { await ensure(); for (const k of Object.keys(cache)) yield [k, cache[k]!] },
    close: async () => { /* noop for file backend */ }
  }
}
