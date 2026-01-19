type DagCborModule = typeof import('@ipld/dag-cbor')
type CarModule = typeof import('@ipld/car')

interface IPLDAPI {
  dagCbor: DagCborModule
  car: CarModule
}

let ipldAPI: IPLDAPI | null = null

export async function initializeIPLD(): Promise<void> {
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

export function getIPLD(): IPLDAPI {
  if (!ipldAPI) {
    throw new Error('IPLD not initialized. Call initializeIPLD() first.')
  }
  return ipldAPI
}

export function isInitialized(): boolean {
  return ipldAPI !== null
}
