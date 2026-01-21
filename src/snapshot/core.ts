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
<<<<<<< HEAD
  /*
  const blocks: SnapshotEVMBlock[] = filteredBlocks.map((blk: any) => {
    const txs = Array.isArray(blk.transactions) ? blk.transactions : []
    const transactions: SnapshotEVMTransaction[] = txs.map((tx: RawBlockchainEvent) => {
      const logsIn = Array.isArray(tx.logs) ? tx.logs : []
      const logs: SnapshotEVMLog[] = logsIn.map((log: RawBlockchainEvent) => ({
        index: Number(log.index),
        address: normalizeHexString(String(log.address)),
        name: String(log.name),
        args: canonicalizeValue(log.args ?? {}) as Record<string, any>
      }))
      logs.sort((a, b) => a.index - b.index)
      return {
        hash: normalizeHexString(String(tx.hash)),
        index: Number(tx.index),
        from: normalizeHexString(String(tx.from)),
        logs
      }
    })
    transactions.sort((a, b) => a.index - b.index)
    return {
      number: BigInt(blk.number),
      hash: normalizeHexString(String(blk.hash)),
      timestamp: BigInt(blk.timestamp),
      transactions,
      internalTransaction: Array.isArray(blk.internalTransaction) ? blk.internalTransaction : []
    }
  })
  blocks.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0))
  */
=======

>>>>>>> bbae288 (Compress snapshot to brotli)
  const entryCount = blocks.reduce((acc, b) => acc + b.transactions.reduce((t: any, tx: { actions: Action[][] }) => t + tx.actions.flat().length, 0), 0)
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
<<<<<<< HEAD
 * Decode DAG-CBOR root from raw bytes (for readFromSnapshot(CID) via IPFS fetch)
 * @param bytes - Input dagCbor encoded snapshot bytes
 * @returns - Decoded snapshot data
 */
async function decodeSnapshotFromBytes (bytes: Uint8Array): Promise<{
  version: number
  chainID: number
  startHeight: number | bigint
  endHeight: number | bigint
  entryCount: number
  blocks: EVMBlock[]
}> {
  const dagCbor = await import('@ipld/dag-cbor')
  return dagCbor.decode(bytes) as any
}

/**
<<<<<<< HEAD
 * Create snapshot by aggregating events from providers into DB.
=======
 * Restore snapshot from the file
 * @param filename - Snapshot file name (uncompressed)
 * @returns Key value pair stored in the snapshot
 */
async function restoreSnapshot (filename = 'snapshot.rsnap') {
  if (!fs.existsSync(filename)) {
    throw new Error("File doesn't exists")
  }

  const stream = fs.createReadStream(filename)
  let buffer = Buffer.alloc(0)
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => {
        const b = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
        buffer = Buffer.concat([buffer, b])
      })
      stream.on('end', () => resolve())
      stream.on('error', (err) => reject(err))
    })

    const result: Record<string, any> = {}
    while (buffer.length > 0) {
      const len = buffer.readUInt32BE(0)
      const payload = buffer.slice(4, 4 + len)

      const [key, val] = decode(payload) as [string, string]
      result[key] = JSON.parse(val)

      buffer = buffer.slice(4 + len)
    }
    return result
  } catch (err) {
    console.log('Failed to read snapshot', err)
  }
  return undefined
}

/**
=======
>>>>>>> a870335 (Add test for snapshot/ remove unsed code)
 * Create snapshot by aggregating events from providers into DB, then writing snapshot file.
<<<<<<< HEAD
>>>>>>> bbae288 (Compress snapshot to brotli)
 * @param createOptions
 * @param createOptions.chainID
 * @param createOptions.startHeight
 * @param createOptions.endHeight
=======
 * @param createOptions - Snapshot create options
 * @param createOptions.chainID - ChainID
 * @param createOptions.dbName - Database name
 * @param createOptions.snapshotFilename - Output snapshot filename
 * @param createOptions.startHeight - Starting height of the output snapshot
 * @param createOptions.endHeight - End height of the output snapshot
>>>>>>> 3c64a77 (Add missing eslint)
 */
async function createSnapshot (createOptions: {
  chainID: number;
  startHeight?: bigint;
  endHeight?: bigint;
}) {
  // TODO: release scanner pls - using RawBlockchainEvent until then
  const { chainID } = createOptions
  if (!chainID) throw new Error('ChainID is not defined')

  const { rpcURL, subsquidURL, deploymentBlock } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB()
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

  const events = await db.get<RawBlockchainEvent[]>('events') ?? []
  console.log(`Starting with ${events.length} existing events in DB`)

  let newEventCount = 0
  for await (const event of eventIterator) {
    events.push(event)
    newEventCount++
    console.log(`Found event ${newEventCount}:`, event)
  }

  await Promise.all([
    fs.promises.writeFile('events-dump.json', JSON.stringify(events, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2)),
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

<<<<<<< HEAD
export { createSnapshot, encodeSnapshot, decodeSnapshot, decodeSnapshotFromBytes }
=======
export { createSnapshot, writeSnapshot, decodeSnapshot }
>>>>>>> a870335 (Add test for snapshot/ remove unsed code)
