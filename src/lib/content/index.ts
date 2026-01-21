import fs from 'node:fs'
import path from 'node:path'

import { getIPLD, getMultiformats } from '../formats'

/**
 * Compute CID from the file
 * @param filePath - Input file to compute CID
 * @returns Computed CID
 */
async function computeRawCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const { CID, raw, sha256 } = getMultiformats()
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
  const { CID, raw } = getMultiformats()
  const { create: createDigest } = await import('multiformats/hashes/digest')
  const { sha256 } = await import('multiformats/hashes/sha2')
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
  const { CID, raw, sha256 } = getMultiformats()
  const { car } = getIPLD()
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
 * Compute CID from encoded dagCbor data
 * @param filePath - Path to the file with encoded dagCbor
 * @returns - Computed CID
 */
async function computeDagCborCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const { dagCbor } = getIPLD()
  const { CID, sha256 } = getMultiformats()
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(dagCbor.code, hash)
  return cid.toString()
}

/**
 * Compute CID from dagCbor encoded bytes
 * @param bytes - Input dagCbor bytes
 * @returns - Computed CID
 */
async function dagCborCIDFromBytes (bytes: Uint8Array): Promise<string> {
  const { dagCbor } = getIPLD()
  const { CID, sha256 } = getMultiformats()
  const hash = await sha256.digest(bytes)
  const cid = CID.createV1(dagCbor.code, hash)
  return cid.toString()
}

/**
 * Encode input object using dagCbor and compute CID
 * @param obj - Input object to encode
 * @returns Encoded object and CID
 */
async function dagCborFromObject (obj: any): Promise<Uint8Array> {
  const { dagCbor } = getIPLD()
  return dagCbor.encode(obj)
}

/**
 * Write CAR object with dagCborRoot
 * @param filePath - Input filepath
 * @param carPath - Output CAR Path
 */
async function writeCarWithDagCborRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const { dagCbor, car } = getIPLD()
  const { CID, sha256 } = getMultiformats()
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(dagCbor.code, hash)
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

export { computeRawCID, rawCIDFromDigestBytes, validateFileCID, writeCarWithRoot, writeCarWithDagCborRoot, computeDagCborCID, dagCborCIDFromBytes, dagCborFromObject }
