import fs from 'fs'

import { decode, encode } from '@msgpack/msgpack'
import dotenv from 'dotenv'
import { RPCProvider, SourceAggregator, SubsquidProvider } from 'fafo-scanner'
import { RPCConnectionManager } from 'fafo-scanner/src/sources/rpc/index.js'

import { RailgunDB } from '../lib/database'
import { dagCborCIDFromObject } from '../lib/content'
import { getNetworkConfigFromChainID } from '../config'

import type { SnapshotEVMBlock, SnapshotEVMLog, SnapshotEVMTransaction } from './types'
import { canonicalizeValue, maxBigInts, minBigInts, normalizeHexString } from './utils'

dotenv.config()

/**
 * Create snapshot from RailgunDB Instance
 * @param railgunDB - Railgun DB Instance
 * @param filename - Output snapshot filename
 */
async function writeSnapshot (railgunDB: RailgunDB, filename = 'snapshot.rsnap') {
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
async function encodeSnapshot (
  railgunDB: RailgunDB,
  outPath: string,
  meta: { chainID: number; startHeight: bigint; endHeight: bigint }
): Promise<string> {
  // todo: check if this is a required thing to sort or not
  const rawBlocks = await railgunDB.get<any[]>('events') ?? []
  const filteredBlocks = rawBlocks.filter((blk: any) => {
    const blockNumber = BigInt(blk.number)
    return blockNumber >= meta.startHeight && blockNumber <= meta.endHeight
  })
  const blocks: SnapshotEVMBlock[] = filteredBlocks.map((blk: any) => {
    const txs = Array.isArray(blk.transactions) ? blk.transactions : []
    const transactions: SnapshotEVMTransaction[] = txs.map((tx: any) => {
      const logsIn = Array.isArray(tx.logs) ? tx.logs : []
      const logs: SnapshotEVMLog[] = logsIn.map((log: any) => ({
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

  const entryCount = blocks.reduce((acc, b) => acc + b.transactions.reduce((t, tx) => t + tx.logs.length, 0), 0)
  const root = {
    version: 1,
    chainID: meta.chainID,
    startHeight: meta.startHeight,
    endHeight: meta.endHeight,
    entryCount,
    blocks
  }

  const { cid, bytes } = await dagCborCIDFromObject(root)
  await fs.promises.writeFile(outPath, Buffer.from(bytes))
  return cid
}

/**
 * Decode a DAG-CBOR snapshot file to root object with blocks
 * @param filePath
 */
async function decodeSnapshot (filePath: string): Promise<{
  version: number
  chainID: number
  startHeight: bigint
  endHeight: bigint
  entryCount: number
  blocks: SnapshotEVMBlock[]
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
async function decodeSnapshotFromBytes (bytes: Uint8Array): Promise<{
  version: number
  chainID: number
  startHeight: number | bigint
  endHeight: number | bigint
  entryCount: number
  blocks: SnapshotEVMBlock[]
}> {
  const dagCbor = await import('@ipld/dag-cbor')
  return dagCbor.decode(bytes) as any
}

/**
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

    const result : Record<string, any> = {}
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
 * @param createOptions
 * @param createOptions.chainID
 * @param createOptions.dbName
 * @param createOptions.snapshotFilename
 * @param createOptions.startHeight
 * @param createOptions.endHeight
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

  const { rpcURL, subsquidURL, deploymentBlock, proxyAddress } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  const connectionManager = new RPCConnectionManager(4)
  const rpcProvider = new RPCProvider(proxyAddress as `0x${string}`, rpcURL, connectionManager)
  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  let startHeight = lastScannedHeight ? BigInt(lastScannedHeight) + 1n : BigInt(deploymentBlock)

  startHeight = createOptions.startHeight ? maxBigInts(startHeight, createOptions.startHeight) : startHeight

  const latestHeight = await rpcProvider.head()
  const endHeight = createOptions.endHeight ? minBigInts(createOptions.endHeight, latestHeight) : latestHeight

  if (startHeight > endHeight) {
    throw new Error(`Invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
  }

  const subsquidHead = await subsquidProvider.head()
  console.log(`SubsquidProvider latest height: ${subsquidHead}`)

  const aggregatedSource = new SourceAggregator([subsquidProvider, rpcProvider])
  const eventIterator = aggregatedSource.from({
    startHeight: startHeight ? BigInt(startHeight) + 1n : deploymentBlock,
    endHeight,
    chunkSize: 10_000n
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
  await writeSnapshot(db, snapshotFilename)
  try { await (db as any).levelDB.close?.() } catch {}
}

export { createSnapshot, writeSnapshot, restoreSnapshot, encodeSnapshot, decodeSnapshot, decodeSnapshotFromBytes }
