import fs from 'fs'
import zlib from 'zlib'

import dotenv from 'dotenv'
import type { Action, EVMBlock } from 'fafo-scanner'
import { SubsquidProvider } from 'fafo-scanner'

import { getNetworkConfigFromChainID } from '../config'
import { dagCborCIDFromBytes, dagCborFromObject } from '../lib/content'
import { RailgunDB } from '../lib/database'

import { maxBigInts, minBigInts } from './utils'

dotenv.config()

/**
 * Encode railgun events into DAG-CBOR and compress it using brotli compression. Also calculate
 * CID and write the compressed data into outPath
 * @param railgunDB - DB instance containing 'events' array
 * @param outPath - output .rsnap path
 * @param meta - chain and range metadata
 * @param meta.chainID - ChainID of the chain to create snapshot
 * @param meta.startHeight - Starting height of the ouput snapshot
 * @param meta.endHeight - End height of the output snapshot
 * @returns computed CID string for the file
 */
async function writeSnapshot (
  railgunDB: RailgunDB,
  outPath: string,
  meta: { chainID: number; startHeight: bigint; endHeight: bigint }
): Promise<string> {
  const rawBlocks = await railgunDB.get<any[]>('events') ?? []
  const blocks = rawBlocks.filter((blk: any) => {
    const blockNumber = BigInt(blk.number)
    return blockNumber >= meta.startHeight && blockNumber <= meta.endHeight
  })

  const entryCount = blocks.reduce((acc, b) => acc + (b.transactions?.reduce((t: any, tx: { actions: Action[][] }) => t + tx.actions.flat().length, 0) ?? 0), 0)
  const root = {
    version: 1,
    chainID: meta.chainID,
    startHeight: meta.startHeight,
    endHeight: meta.endHeight,
    entryCount,
    blocks
  }
  const bytes = await dagCborFromObject(root)
  const compressedData = zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6
    }
  })
  const [cid] = await Promise.all([
    dagCborCIDFromBytes(compressedData),
    fs.promises.writeFile(outPath, compressedData),
  ])
  return cid
}

/**
 * Decode a compressed DAG-CBOR snapshot into metaData and eventBlocks
 * from file
 * @param filePath - Filepath to the encoded snapshot
 * @returns - Decoded snapshot data
 */
async function decodeSnapshot (filePath: string): Promise<{
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: EVMBlock[]
}> {
  const dagCbor = await import('@ipld/dag-cbor')
  const data = await fs.promises.readFile(filePath)
  const decompressedData = zlib.brotliDecompressSync(data)
  return dagCbor.decode(decompressedData) as any
}

/**
 * Create snapshot by aggregating events from providers into DB, then writing snapshot file.
 * @param createOptions - Snapshot create options
 * @param createOptions.chainID - ChainID
 * @param createOptions.dbName - Database name
 * @param createOptions.snapshotFilename - Output snapshot filename
 * @param createOptions.startHeight - Starting height of the output snapshot
 * @param createOptions.endHeight - End height of the output snapshot
 */
async function createSnapshot (createOptions: {
  chainID: number;
  dbName: string;
  snapshotFilename: string;
  startHeight?: bigint;
  endHeight?: bigint;
}) {
  // TODO: release scanner pls
  type EVMBlock = any

  const { chainID, dbName, snapshotFilename } = createOptions
  if (!chainID) throw new Error('ChainID is not defined')

  const { rpcURL, subsquidURL, deploymentBlock } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  let startHeight = lastScannedHeight ? BigInt(lastScannedHeight) + 1n : BigInt(deploymentBlock)

  startHeight = createOptions.startHeight ? maxBigInts(startHeight, createOptions.startHeight) : startHeight

  const latestHeight = await subsquidProvider.head()
  const endHeight = createOptions.endHeight ? minBigInts(createOptions.endHeight, latestHeight) : latestHeight

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const subsquidHead = await subsquidProvider.head()
  console.log(`SubsquidProvider latest height: ${subsquidHead}`)

  const eventIterator = subsquidProvider.from({
    startHeight: startHeight ? BigInt(startHeight) + 1n : deploymentBlock,
    liveSync: false,
    endHeight,
  })

  const events = await db.get<EVMBlock[]>('events') ?? []
  console.log(`Starting with ${events.length} existing events in DB`)

  let newEventCount = 0
  for await (const event of eventIterator) {
    events.push(event)
    newEventCount++
    console.log(`Found event ${newEventCount}:`, event)
  }

  fs.writeFileSync('events-dump.json', JSON.stringify(events, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2))

  await Promise.all([
    db.set('latestHeight', endHeight.toString()),
    db.set('events', events)
  ])

  await writeSnapshot(db, snapshotFilename, {
    chainID,
    startHeight,
    endHeight
  })
  try { await (db as any).levelDB.close?.() } catch { }
}

export { createSnapshot, writeSnapshot, decodeSnapshot }
