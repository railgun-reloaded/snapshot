type Serializable = string | number | boolean | object | null

/**
 * Simple in-memory data store for snapshot operations
 * Replaces the complex LevelDB implementation for basic get/set operations
 */
class RailgunDB {
  #data = new Map<string, any>()

  /**
   * Initialize the database
   * @param _dbPath - Database path (ignored in in-memory implementation)
   * @param _opts - Options (ignored in in-memory implementation)
   */
  constructor(_dbPath?: string, _opts?: any) {
    // No-op - in-memory store doesn't need path or options
  }

  /**
   * Set a value in the store
   * @param key - Key to set
   * @param value - Value to store
   */
  async set(key: string, value: Serializable) {
    this.#data.set(key, value)
  }

  /**
   * Get a value from the store
   * @param key - Key to retrieve
   * @returns The stored value or null if not found
   */
  async get<T = Serializable>(key: string): Promise<T | null> {
    return this.#data.get(key) ?? null
  }

  /**
   * Iterate over all entries in the store
   */
  async *entries(): AsyncIterable<[string, any]> {
    for (const [key, value] of this.#data) {
      yield [key, JSON.stringify(value)]
    }
  }

  /**
   * Close the database (no-op for in-memory store)
   */
  async close() {
    // No-op for in-memory implementation
  }

  /**
   * Legacy getter for compatibility
   */
  get levelDB() {
    return this.#data
  }
}

export { RailgunDB }
export type { Serializable }