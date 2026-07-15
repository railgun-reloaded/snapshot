import fs from 'fs'
import zlib from 'zlib'

import type { EVMBlock } from '@railgun-reloaded/scanner'
import { SubsquidProvider } from '@railgun-reloaded/scanner'

import { getNetworkConfigFromChainID } from '../config/index.js'
import { artifactCIDFromBytes } from '../lib/content/artifact.js'
import { RailgunDB } from '../lib/database/index.js'

import type {
  EncodeSnapshotBlock,
  EncodeSnapshotMetadata
} from './codec.js'
import {
  BROTLI_QUALITY,
  MAX_DECOMPRESSED_SIZE,
  decodeSnapshotContent,
  encodeSnapshotContent,
  verifyArtifactCID
} from './codec.js'
import type { Snapshot } from './types.js'
import { minBigInts } from './utils.js'

/**
 * Decode a verified snapshot artifact from in-memory bytes using Node zlib.
 * @param bytes - Compressed snapshot artifact bytes.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded and validated snapshot.
 */
async function decodeArtifact (
  bytes: Uint8Array,
  expectedCid: string
): Promise<Snapshot> {
  await verifyArtifactCID(bytes, expectedCid)

  const decompressed = zlib.brotliDecompressSync(bytes, {
    maxOutputLength: MAX_DECOMPRESSED_SIZE
  })

  return decodeSnapshotContent(decompressed)
}

/**
 * Write encoded snapshot data to a file.
 * @param outPath - Output .rsnap path.
 * @param bytes - Byte representation of snapshot data.
 * @returns Promise to write file.
 */
async function writeSnapshot (
  outPath: string,
  bytes: Uint8Array
): Promise<void> {
  return fs.promises.writeFile(outPath, bytes)
}

/**
 * Encode railgun blocks into DAG-CBOR and compress them with Node zlib brotli.
 *
 * `encodeSnapshot` is synchronous; its output is byte-identical for the same
 * input under the Node entry.
 * @param blocks - Input blocks to encode.
 * @param metadata - Chain and block range metadata.
 * @returns Encoded `.rsnap` bytes.
 */
function encodeSnapshot (
  blocks: EncodeSnapshotBlock[],
  metadata: EncodeSnapshotMetadata
): Uint8Array {
  return zlib.brotliCompressSync(encodeSnapshotContent(blocks, metadata), {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY
    }
  })
}

/**
 * Filter the data from DB in the range of [startHeight, endHeight] and create
 * compressed snapshot artifact bytes.
 * @param db - Encode snapshot from DB.
 * @param metadata - Chain and block range metadata.
 * @returns Encoded `.rsnap` bytes.
 */
async function encodeSnapshotFromDB (
  db: RailgunDB,
  metadata: EncodeSnapshotMetadata
): Promise<Uint8Array> {
  const blocks = await db.get<EncodeSnapshotBlock[]>('blocks') ?? []
  return encodeSnapshot(blocks, metadata)
}

/**
 * Decode a compressed DAG-CBOR snapshot from file.
 * @param filePath - Filepath to the encoded snapshot.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded snapshot data.
 */
async function decodeSnapshot (
  filePath: string,
  expectedCid: string
): Promise<Snapshot> {
  const data = new Uint8Array(await fs.promises.readFile(filePath))
  return decodeArtifact(data, expectedCid)
}

/**
 * Decode a compressed DAG-CBOR snapshot from file and write it to DB.
 * @param filePath - Filepath to the encoded snapshot.
 * @param db - RailgunDatabase instance.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded snapshot data.
 */
async function decodeSnapshotToDB (
  filePath: string,
  db: RailgunDB,
  expectedCid: string
): Promise<Snapshot> {
  const decodedData = await decodeSnapshot(filePath, expectedCid)

  await db.set('latestHeight', decodedData.endHeight)
  await db.set('blocks', decodedData.blocks)

  return decodedData
}

/**
 * Create snapshot by aggregating blocks from providers into DB, encoding and
 * writing to file. Returns the calculated CID of the final data.
 * @param createOptions - Snapshot create options.
 * @param createOptions.chainID - ChainID.
 * @param createOptions.dbName - Database name.
 * @param createOptions.snapshotFilename - Output snapshot filename.
 * @param createOptions.startHeight - Starting height of the output snapshot.
 * @param createOptions.endHeight - End height of the output snapshot.
 * @returns CID of created snapshot file.
 */
async function createSnapshot (createOptions: {
  chainID: number;
  dbName: string;
  snapshotFilename: string;
  startHeight?: bigint;
  endHeight?: bigint;
}): Promise<string> {
  const { chainID, dbName, snapshotFilename } = createOptions

  if (!chainID) {
    throw new Error('ChainID is not defined')
  }
  const { rpcURL, subsquidURL, deploymentBlock } =
    getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  let startHeight: bigint
  if (createOptions.startHeight) {
    startHeight = createOptions.startHeight
  } else if (lastScannedHeight) {
    startHeight = BigInt(lastScannedHeight) + 1n
  } else {
    startHeight = BigInt(deploymentBlock)
  }

  const latestHeight = await subsquidProvider.head()
  const endHeight = createOptions.endHeight
    ? minBigInts(createOptions.endHeight, latestHeight)
    : latestHeight

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  console.log(`SubsquidProvider latest height: ${latestHeight}`)

  const blockIterator = subsquidProvider.from({
    startHeight,
    liveSync: false,
    endHeight
  })

  const blocks = await db.get<EVMBlock[]>('blocks') ?? []
  console.log(`Starting with ${blocks.length} existing blocks in DB`)

  for await (const block of blockIterator) {
    blocks.push(block)
  }

  await Promise.all([
    db.set('latestHeight', endHeight.toString()),
    db.set('blocks', blocks)
  ])

  const encodedData = encodeSnapshot(blocks, {
    chainID,
    startHeight,
    endHeight
  })

  await writeSnapshot(snapshotFilename, encodedData)

  try { await (db as any).levelDB.close?.() } catch { }

  return artifactCIDFromBytes(encodedData)
}

export {
  createSnapshot,
  decodeArtifact,
  decodeSnapshot,
  decodeSnapshotToDB,
  encodeSnapshot,
  encodeSnapshotFromDB,
  writeSnapshot
}
export type { EncodeSnapshotMetadata }
