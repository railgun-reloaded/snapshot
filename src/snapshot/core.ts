import fs, { createWriteStream } from 'fs'

import dotenv from 'dotenv'
import { SubsquidProvider } from 'fafo-scanner'
import type { Action, EVMBlock } from 'fafo-scanner'

import { RailgunDB } from '../lib/database'
import { dagCborCIDFromObject } from '../lib/content'
import zlib from 'zlib'
import { getNetworkConfigFromChainID } from '../config'
import { maxBigInts, minBigInts } from './utils'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

dotenv.config()

/**
 * Create snapshot from RailgunDB Instance
 * @param railgunDB - Railgun DB Instance
 * @param filename - Output snapshot filename
 */
async function writeSnapshot(railgunDB: RailgunDB, filename = 'snapshot.rsnap') {
  // base method for writing events to db, still needs work
  const outFile = fs.createWriteStream(filename)
  for await (const [key, val] of railgunDB.entries()) {
    const entry = encode([key, val])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(entry.length, 0)
    outFile.write(len)
    outFile.write(entry)
  }
  outFile.end()
  await new Promise<void>(resolve => outFile.on('finish', () => resolve()))
}

/**
 * Create a canonical DAG-CBOR snapshot file with blocks/tx/logs
 * @param railgunDB - DB instance containing 'events' array
 * @param outPath - output .rsnap path (DAG-CBOR encoded root)
 * @param meta - chain and range metadata
 * @param meta.chainID
 * @param meta.startHeight
 * @param meta.endHeight
 * @returns computed CID string for the DAG-CBOR root
 */
async function encodeSnapshot(
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
  const { cid, bytes } = await dagCborCIDFromObject(root)

  await pipeline(
    Readable.from([bytes]),
    zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 6
      }
    }),
    createWriteStream(outPath)
  );
  return cid
}

/**
 * Decode a DAG-CBOR snapshot file to root object with blocks
 * @param filePath
 */
async function decodeSnapshot(filePath: string): Promise<{
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: EVMBlock[]
}> {
  const dagCbor = await import('@ipld/dag-cbor')
  const data = await fs.promises.readFile(filePath)
  const root = dagCbor.decode(new Uint8Array(data)) as any
  return root
}

/**
 * Decode DAG-CBOR root from raw bytes (for readFromSnapshot(CID) via IPFS fetch)
 * @param bytes
 */
async function decodeSnapshotFromBytes(bytes: Uint8Array): Promise<{
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
async function restoreSnapshot(filename = 'snapshot.rsnap') {
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
 * Create snapshot by aggregating events from providers into DB, then writing snapshot file.
>>>>>>> bbae288 (Compress snapshot to brotli)
 * @param createOptions
 * @param createOptions.chainID
 * @param createOptions.startHeight
 * @param createOptions.endHeight
 */
async function createSnapshot(createOptions: {
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
  await writeSnapshot(db, snapshotFilename)
  try { await (db as any).levelDB.close?.() } catch { }
}

export { createSnapshot, encodeSnapshot, decodeSnapshot, decodeSnapshotFromBytes }
