import fs from 'node:fs'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { create as mhCreate } from 'multiformats/hashes/digest'
import { CarWriter } from '@ipld/car'

async function computeRawCID (filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  return cid.toString()
}

function rawCIDFromDigestBytes (digestBytes: Uint8Array): string {
  const mh = mhCreate(sha256.code, digestBytes)
  const cid = CID.createV1(raw.code, mh)
  return cid.toString()
}

async function validateFileCID (filePath: string, expectedCid: string): Promise<boolean> {
  const cid = await computeRawCID(filePath)
  return cid === expectedCid
}

async function writeCarWithRoot (filePath: string, carPath: string): Promise<void> {
  const data = await fs.promises.readFile(filePath)
  const hash = await sha256.digest(new Uint8Array(data))
  const cid = CID.createV1(raw.code, hash)
  const { writer, out } = CarWriter.create([cid])
  const ws = fs.createWriteStream(carPath)
  const pump = (async () => {
    for await (const chunk of out) ws.write(chunk)
    ws.end()
  })()
  await writer.put({ cid, bytes: new Uint8Array(data) })
  await writer.close()
  await pump
}

export { computeRawCID, rawCIDFromDigestBytes, validateFileCID, writeCarWithRoot }
