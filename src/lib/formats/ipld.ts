// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type DagCborModule = typeof import('@ipld/dag-cbor')
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CarModule = typeof import('@ipld/car')
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CborgModule = typeof import('cborg')
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CborgTaglibModule = typeof import('cborg/taglib')

interface IPLDAPI {
  dagCbor: DagCborModule
  car: CarModule
  cborg: CborgModule
  cborgTaglib: CborgTaglibModule
}

let ipldAPI: IPLDAPI | null = null

/**
 * Initialize IPLD
 */
async function initializeIPLD (): Promise<void> {
  if (ipldAPI) return

  const [dagCbor, car, cborg, cborgTaglib] = await Promise.all([
    import('@ipld/dag-cbor'),
    import('@ipld/car'),
    import('cborg'),
    import('cborg/taglib')
  ])

  ipldAPI = {
    dagCbor,
    car,
    cborg,
    cborgTaglib
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
function isIPLDInitialized (): boolean {
  return ipldAPI !== null
}

export { initializeIPLD, getIPLD, isIPLDInitialized }
