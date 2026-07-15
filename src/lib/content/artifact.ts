import { create as createDigest } from 'multiformats/hashes/digest'

import { CID, raw, sha256 } from '../formats/multiformats.js'

/**
 * Compute CID from DigestBytes.
 * @param digestBytes - Input digest bytes.
 * @returns Computed CID.
 */
async function rawCIDFromDigestBytes (digestBytes: Uint8Array): Promise<string> {
  const mh = createDigest(sha256.code, digestBytes)
  const cid = CID.createV1(raw.code, mh)
  return cid.toString()
}

/**
 * Compute the artifact CID for in-memory snapshot bytes.
 *
 * Uses the `raw` codec (0x55) because the bytes are an opaque, brotli-compressed
 * blob rather than a traversable IPLD object. This keeps the codec honest so the
 * block imports and resolves on standards-compliant IPFS tooling.
 * @param bytes - Encoded snapshot artifact bytes.
 * @returns Computed CID.
 */
async function artifactCIDFromBytes (bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes)
  const cid = CID.createV1(raw.code, hash)
  return cid.toString()
}

export { artifactCIDFromBytes, rawCIDFromDigestBytes }
