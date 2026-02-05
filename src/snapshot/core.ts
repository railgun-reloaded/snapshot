import fs from 'fs'
import zlib from 'zlib'

import type { Action, EVMBlock } from 'fafo-scanner'
import { SubsquidProvider } from 'fafo-scanner'

import { getNetworkConfigFromChainID } from '../config'
import { computeDagCborCID, dagCborCIDFromBytes } from '../lib/content'
import { RailgunDB } from '../lib/database'

import { DAGCBORCodec } from './dagcbor-codec'
import { minBigInts } from './utils'

const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024

/**
 * Encode railgun blocks into DAG-CBOR and compress it using brotli compression. Also calculate
 * CID and write the compressed data into outPath
 * @param outPath - output .rsnap path
 * @param bytes - Byte representation of snapshot data
 * @returns - Promise to writeFile
 */
async function writeSnapshot (
  outPath: string,
  bytes: Uint8Array
): Promise<void> {
  return fs.promises.writeFile(outPath, bytes)
}

/**
 * Filter the input data within the range of start and end height and create snapshot data.
 * Encode the snapshot using DAGCBOR encoding and compress it using brotli compression
 * @param blocks - Input block to encode
 * @param metadata - Chain/Block related metadata
 * @param metadata.chainID - ChainID of the network
 * @param metadata.startHeight - Startheight of the block
 * @param metadata.endHeight - End Height of the block
 * @returns - Encoded data
 */
function encodeSnapshot (blocks: EVMBlock[], metadata: {
  chainID: number,
  startHeight: bigint,
  endHeight: bigint
}) : Uint8Array {
  const { chainID, startHeight, endHeight } = metadata

  // Validate height range
  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const filteredBlocks = blocks.filter((blk: any) => {
    const blockNumber = BigInt(blk.number)
    return blockNumber >= metadata.startHeight && blockNumber <= metadata.endHeight
  })

  // Calculate total number of action entries from the transaction
  const entryCount = filteredBlocks.reduce(
    (acc, b) => acc + (b.transactions?.reduce((t: any, tx: { actions?: Action[][] }) => t + (tx.actions?.flat().length ?? 0), 0) ?? 0),
    0)

  const snapshotContent = {
    version: 1,
    chainID,
    startHeight,
    endHeight,
    entryCount,
    blocks: filteredBlocks
  }

  const bytes = DAGCBORCodec.encodeToBytes(snapshotContent)
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6
    }
  })
}

/**
 * Filter the data from DB in the range of [startHeight, endHeight] and create snapshot data.
 * Encode the snapshot using DAGCBOR encoding and compress it using brotli compression
 * @param db - Encode snapshot from DB
 * @param metadata - Chain/Block related metadata
 * @param metadata.chainID - ChainID of the network
 * @param metadata.startHeight - Startheight of the block
 * @param metadata.endHeight - End Height of the block
 * @returns - Encoded data
 */
async function encodeSnapshotFromDB (db: RailgunDB, metadata: {
  chainID: number,
  startHeight: bigint,
  endHeight: bigint
}) : Promise<Uint8Array> {
  const blocks = await db.get<EVMBlock[]>('blocks') ?? []
  return encodeSnapshot(blocks, metadata)
}

/**
 * Decode a compressed DAG-CBOR snapshot into metaData and eventBlocks
 * from file
 * @param filePath - Filepath to the encoded snapshot
 * @param expectedCid - Optional CID to validate against (recommended for security)
 * @returns - Decoded snapshot data
 */
async function decodeSnapshot (filePath: string, expectedCid?: string): Promise<{
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: EVMBlock[]
}> {
  const dagCbor = await import('@ipld/dag-cbor')
  const data = await fs.promises.readFile(filePath)

  if (expectedCid) {
    const actualCid = await computeDagCborCID(filePath)
    if (actualCid !== expectedCid) {
      throw new Error(`CID mismatch: expected ${expectedCid}, got ${actualCid}`)
    }
  }

  const decompressedData = zlib.brotliDecompressSync(data, {
    maxOutputLength: MAX_DECOMPRESSED_SIZE
  })

  return dagCbor.decode(decompressedData) as any
}

/**
 * Decode a compressed DAG-CBOR snapshot into metaData and eventBlocks
 * from file and write to DB
 * @param filePath - Filepath to the encoded snapshot
 * @param db - RailgunDatabase Instance
 * @param expectedCid - Optional CID to validate against (recommended for security)
 * @returns - Decoded snapshot data
 */
async function decodeSnapshotToDB (filePath: string, db: RailgunDB, expectedCid?: string): Promise<{
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: EVMBlock[]
}> {
  const decodedData = await decodeSnapshot(filePath, expectedCid)

  db.set('latestHeight', decodedData.endHeight)
  db.set('blocks', decodedData.blocks)

  return decodedData
}

/**
 * Create snapshot by aggregating blocks from providers into DB, encode and compress it
 * and write to file. Return the calculated CID of the final data
 * @param createOptions - Snapshot create options
 * @param createOptions.chainID - ChainID
 * @param createOptions.dbName - Database name
 * @param createOptions.snapshotFilename - Output snapshot filename
 * @param createOptions.startHeight - Starting height of the output snapshot
 * @param createOptions.endHeight - End height of the output snapshot
 * @returns - CID of created snapshot file
 */
async function createSnapshot (createOptions: {
  chainID: number;
  dbName: string;
  snapshotFilename: string;
  startHeight?: bigint;
  endHeight?: bigint;
}) {
  type EVMBlock = any

  const { chainID, dbName, snapshotFilename } = createOptions

  if (!chainID) {
    throw new Error('ChainID is not defined')
  }
  const { rpcURL, subsquidURL, deploymentBlock } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  // Determine the starting height for this snapshot
  // Priority: user-specified startHeight > last scanned + 1 > deployment block
  let startHeight: bigint
  if (createOptions.startHeight) {
    startHeight = createOptions.startHeight
  } else if (lastScannedHeight) {
    startHeight = BigInt(lastScannedHeight) + 1n
  } else {
    startHeight = BigInt(deploymentBlock)
  }

  const latestHeight = await subsquidProvider.head()
  const endHeight = createOptions.endHeight ? minBigInts(createOptions.endHeight, latestHeight) : latestHeight

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  console.log(`SubsquidProvider latest height: ${latestHeight}`)

  const blockIterator = subsquidProvider.from({
    startHeight,
    liveSync: false,
    endHeight,
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

  return dagCborCIDFromBytes(encodedData)
}

export { createSnapshot, writeSnapshot, encodeSnapshot, decodeSnapshot, encodeSnapshotFromDB, decodeSnapshotToDB }
