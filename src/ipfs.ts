import fs from 'node:fs'
import path from 'node:path'

async function computeRawCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const mf = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = mf.CID.createV1((raw as any).code, hash)
  return cid.toString()
}

async function rawCIDFromDigestBytes (digestBytes: Uint8Array): Promise<string> {
  const mf = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { create: mhCreate } = await import('multiformats/hashes/digest')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const mh = mhCreate(sha256.code, digestBytes)
  const cid = mf.CID.createV1((raw as any).code, mh)
  return cid.toString()
}

async function validateFileCID (filePath: string, expectedCid: string): Promise<boolean> {
  const cid = await computeRawCID(filePath)
  return cid === expectedCid
}

async function writeCarWithRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const mf = await import('multiformats')
  const raw = await import('multiformats/codecs/raw')
  const { sha256 } = await import('multiformats/hashes/sha2')
  const { CarWriter } = await import('@ipld/car')
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = mf.CID.createV1((raw as any).code, hash)
  const { writer, out } = CarWriter.create([cid as any])
  const chunks: Uint8Array[] = []
  const collect = (async () => { for await (const c of out) chunks.push(c) })()
  await writer.put({ cid: cid as any, bytes: new Uint8Array(data) })
  await writer.close()
  await collect
  await fs.promises.mkdir(path.dirname(carPath), { recursive: true })
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  await fs.promises.writeFile(carPath, buf)
}

export { computeRawCID, rawCIDFromDigestBytes, validateFileCID, writeCarWithRoot }
