import { ClassicLevel } from 'classic-level'

type Serializable = string | number | boolean | object | null

/**
 * Railgun Database Instance
 */
class RailgunDB {
  /**
   * Name of Database
   */
  #dbName: string

  /**
   * Instance of ClassicLevel Database
   */
  #db: ClassicLevel

  /**
   * Initialize Railgun Event Database
   * @param dbName - Name of Database
   */
  constructor (dbName: string) {
    this.#dbName = dbName
    this.#db = new ClassicLevel(this.#dbName)
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
      const values = await this.#db.get(key)
      if (values) { return JSON.parse(values) as T }
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
    return this.#db
  }
}

export { RailgunDB }
export type { Serializable }
