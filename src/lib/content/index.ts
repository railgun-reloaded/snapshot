import fs from 'node:fs'
import path from 'node:path'

import { create as createDigest } from 'multiformats/hashes/digest'

import { CID, car, raw, sha256 } from '../formats/index.js'

/**
 * Compute CID from the file
 * @param filePath - Input file to compute CID
 * @returns Computed CID
 */
async function computeRawCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  return cid.toString()
}

/**
 * Compute CID from DigestBytes
 * @param digestBytes - Input digest bytes
 * @returns Computed CID
 */
async function rawCIDFromDigestBytes (digestBytes: Uint8Array): Promise<string> {
  const mh = createDigest(sha256.code, digestBytes)
  const cid = CID.createV1(raw.code, mh)
  return cid.toString()
}

/**
 * Validate CID for given file
 * @param filePath - Input file path
 * @param expectedCid - Expected CID for given file path
 * @returns True if expected CID is equal to computed CID, else false
 */
async function validateFileCID (filePath: string, expectedCid: string): Promise<boolean> {
  const cid = await computeRawCID(filePath)
  return cid === expectedCid
}

/**
 * Write CAR object with root
 * @param filePath - Input filepath
 * @param carPath - Output CAR Path
 */
async function writeCarWithRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  const { writer, out } = car.CarWriter.create([cid])
  const chunks: Uint8Array[] = []
  const collect = (async () => { for await (const c of out) chunks.push(c) })()
  await writer.put({ cid, bytes: new Uint8Array(data) })
  await writer.close()
  await collect
  await fs.promises.mkdir(path.dirname(carPath), { recursive: true })
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  await fs.promises.writeFile(carPath, buf)
}

/**
 * Compute the artifact CID for an on-disk snapshot.
 *
 * The artifact is a brotli-compressed blob, so it is opaque bytes from IPLD's
 * point of view. The CID therefore uses the `raw` codec (0x55) to honestly
 * describe the byte encoding; codec-aware backends (Kubo, Helia, gateways) can
 * import and serve it without attempting to decode it as a structured object.
 * @param filePath - Path to the encoded snapshot artifact
 * @returns - Computed CID
 */
async function computeArtifactCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  return artifactCIDFromBytes(new Uint8Array(data))
}

/**
 * Compute the artifact CID for in-memory snapshot bytes.
 *
 * Uses the `raw` codec (0x55) because the bytes are an opaque, brotli-compressed
 * blob rather than a traversable IPLD object. This keeps the codec honest so the
 * block imports and resolves on standards-compliant IPFS tooling.
 * @param bytes - Encoded snapshot artifact bytes
 * @returns - Computed CID
 */
async function artifactCIDFromBytes (bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes)
  const cid = CID.createV1(raw.code, hash)
  return cid.toString()
}

/**
 * Write a CAR whose root is the snapshot artifact CID.
 *
 * The root block is stored under the `raw` codec (0x55) so its codec matches the
 * opaque brotli-compressed bytes it addresses, letting the CAR import into a
 * codec-aware backend without a decode error.
 * @param filePath - Input filepath
 * @param carPath - Output CAR Path
 */
async function writeCarWithArtifactRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  const { writer, out } = car.CarWriter.create([cid])
  const chunks: Uint8Array[] = []
  const collect = (async () => { for await (const c of out) chunks.push(c) })()
  await writer.put({ cid, bytes: new Uint8Array(data) })
  await writer.close()
  await collect
  await fs.promises.mkdir(path.dirname(carPath), { recursive: true })
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  await fs.promises.writeFile(carPath, buf)
}

export { computeRawCID, rawCIDFromDigestBytes, validateFileCID, writeCarWithRoot, writeCarWithArtifactRoot, computeArtifactCID, artifactCIDFromBytes }
