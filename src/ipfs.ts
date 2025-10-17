import fs from 'node:fs'
import path from 'node:path'
// ESM-only libs are imported dynamically for CJS compatibility

async function computeRawCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const { CID } = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  return cid.toString()
}

async function rawCIDFromDigestBytes (digestBytes: Uint8Array): Promise<string> {
  const { CID } = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { create: createDigest } = await import('multiformats/hashes/digest')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const mh = createDigest(sha256.code, digestBytes)
  const cid = CID.createV1(raw.code, mh)
  return cid.toString()
}

async function validateFileCID (filePath: string, expectedCid: string): Promise<boolean> {
  const cid = await computeRawCID(filePath)
  return cid === expectedCid
}

async function writeCarWithRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const { CID } = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const { CarWriter } = await import('@ipld/car')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  const { writer, out } = CarWriter.create([cid])
  const chunks: Uint8Array[] = []
  const collect = (async () => { for await (const c of out) chunks.push(c) })()
  await writer.put({ cid, bytes: new Uint8Array(data) })
  await writer.close()
  await collect
  await fs.promises.mkdir(path.dirname(carPath), { recursive: true })
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  await fs.promises.writeFile(carPath, buf)
}

async function computeDagCborCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const dagCbor = await import('@ipld/dag-cbor')
  const { CID } = await import('multiformats')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(dagCbor.code, hash)
  return cid.toString()
}

async function dagCborCIDFromBytes (bytes: Uint8Array): Promise<string> {
  const dagCbor = await import('@ipld/dag-cbor')
  const { CID } = await import('multiformats')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const hash = await sha256.digest(bytes)
  const cid = CID.createV1(dagCbor.code, hash)
  return cid.toString()
}

async function dagCborCIDFromObject (obj: any): Promise<{ cid: string; bytes: Uint8Array }> {
  const dagCbor = await import('@ipld/dag-cbor')
  const bytes: Uint8Array = dagCbor.encode(obj)
  const cid = await dagCborCIDFromBytes(bytes)
  return { cid, bytes }
}

async function writeCarWithDagCborRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const dagCbor = await import('@ipld/dag-cbor')
  const { CID } = await import('multiformats')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const { CarWriter } = await import('@ipld/car')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(dagCbor.code, hash)
  const { writer, out } = CarWriter.create([cid])
  const chunks: Uint8Array[] = []
  const collect = (async () => { for await (const c of out) chunks.push(c) })()
  await writer.put({ cid, bytes: new Uint8Array(data) })
  await writer.close()
  await collect
  await fs.promises.mkdir(path.dirname(carPath), { recursive: true })
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  await fs.promises.writeFile(carPath, buf)
}

export { computeRawCID, rawCIDFromDigestBytes, validateFileCID, writeCarWithRoot, writeCarWithDagCborRoot, computeDagCborCID, dagCborCIDFromBytes, dagCborCIDFromObject }
