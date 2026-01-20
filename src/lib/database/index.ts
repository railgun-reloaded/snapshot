type Serializable = string | number | boolean | bigint | object | null | Serializable[]

/**
 * Simple in-memory data store for snapshot operations, to be replaced with drizzle
 */
class RailgunDB {
  /**
   * Store any key value pair
   */
  #data = new Map<string, any>()

  /**
   * Initialize the database
   * @param _dbPath - DB path
   * @param _opts - DB initialization options
   */
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor (_dbPath?: string, _opts?: any) {
  }

  /**
   * Set a value in the store
   * @param key - Key to set
   * @param value - Value to store
   */
  async set (key: string, value: Serializable) {
    this.#data.set(key, value)
  }

  /**
   * Get a value from the store
   * @param key - Key to retrieve
   * @returns The stored value or null if not found
   */
  async get<T = Serializable>(key: string): Promise<T | null> {
    return (this.#data.get(key) as T) ?? null
  }

  /**
   * Iterate over all entries in the store
   * @returns - Key value iterator over the entries
   * @yields - Key value pair for entries
   */
  async * entries (): AsyncIterable<[string, any]> {
    for (const [key, value] of this.#data) {
      yield [key, JSON.stringify(value)]
    }
  }

  /**
   * Close the database (no-op for in-memory store)
   */
  async close () {
    // todo
  }
}

export { RailgunDB }
export type { Serializable }
