type MultiformatsModule = typeof import('multiformats')
type RawCodec = typeof import('multiformats/codecs/raw')
type Sha256Hasher = typeof import('multiformats/hashes/sha2')

interface MultiformatsAPI {
  CID: MultiformatsModule['CID']
  raw: RawCodec
  sha256: Sha256Hasher['sha256']
}

let multiformatsAPI: MultiformatsAPI | null = null

export async function initializeMultiformats(): Promise<void> {
  if (multiformatsAPI) return

  const [multiformats, raw, { sha256 }] = await Promise.all([
    import('multiformats'),
    import('multiformats/codecs/raw'),
    import('multiformats/hashes/sha2')
  ])

  multiformatsAPI = {
    CID: multiformats.CID,
    raw,
    sha256
  }
}

export function getMultiformats(): MultiformatsAPI {
  if (!multiformatsAPI) {
    throw new Error('Multiformats not initialized. Call initializeMultiformats() first.')
  }
  return multiformatsAPI
}

export function isInitialized(): boolean {
  return multiformatsAPI !== null
}
