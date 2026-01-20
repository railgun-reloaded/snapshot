// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type DagCborModule = typeof import('@ipld/dag-cbor')
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CarModule = typeof import('@ipld/car')

interface IPLDAPI {
  dagCbor: DagCborModule
  car: CarModule
}

let ipldAPI: IPLDAPI | null = null

/**
 * Initialize IPLD
 */
async function initializeIPLD (): Promise<void> {
  if (ipldAPI) return

  const [dagCbor, car] = await Promise.all([
    import('@ipld/dag-cbor'),
    import('@ipld/car')
  ])

  ipldAPI = {
    dagCbor,
    car
  }
}

/**
 * Get IPLDAPI object
 * @returns IDLDAPI object
 */
function getIPLD (): IPLDAPI {
  if (!ipldAPI) {
    throw new Error('IPLD not initialized. Call initializeIPLD() first.')
  }
  return ipldAPI
}

/**
 * Check if IPLD is initialized or not
 * @returns initializaition status of IPLDAPI
 */
function isInitialized (): boolean {
  return ipldAPI !== null
}
