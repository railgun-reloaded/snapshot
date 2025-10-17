import fs from 'fs'

import { decode, encode } from '@msgpack/msgpack'
import dotenv from 'dotenv'

import { RailgunDB } from './database'
dotenv.config()

function maxBigInts (a: bigint, b: bigint) { return a > b ? a : b }
function minBigInts (a: bigint, b: bigint) { return a < b ? a : b }

/**
 * Create snapshot from RailgunDB Instance
 * @param railgunDB - Railgun DB Instance
 * @param filename - Output snapshot filename
 */
async function writeSnapshot (railgunDB: RailgunDB, filename = 'snapshot.rsnap') {
  // base method for writing events to db, still needs work
  const outFile = fs.createWriteStream(filename)
  const levelDB = railgunDB.levelDB
  for await (const [key, val] of levelDB.iterator()) {
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
  const { RPCProvider, SourceAggregator, SubsquidProvider } = require('fafo-scanner')
  const { RPCConnectionManager } = require('fafo-scanner/src/sources/rpc')

  const { chainID, dbName, snapshotFilename } = createOptions
  if (!chainID) throw new Error('ChainID is not defined')

  // todo: refactor config module
  const { getNetworkConfigFromChainID } = require('./network-config')
  const { name: networkName, rpcURL, subsquidURL, deploymentBlock, proxyAddress } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  console.log('//// Creating snapshot for ', networkName)

  const connectionManager = new RPCConnectionManager(4)
  const rpcProvider = new RPCProvider(proxyAddress as `0x${string}`, rpcURL, connectionManager)
  const subsquidProvider = new SubsquidProvider(subsquidURL)

  const db = new RailgunDB(dbName)
  const lastScannedHeight = await db.get<string>('latestHeight')

  let startHeight = lastScannedHeight ? BigInt(lastScannedHeight) + 1n : BigInt(deploymentBlock)
  startHeight = createOptions.startHeight ? maxBigInts(startHeight, createOptions.startHeight) : startHeight

  const latestHeight = await rpcProvider.head()
  const endHeight = createOptions.endHeight ? minBigInts(createOptions.endHeight, latestHeight) : latestHeight

  const aggregatedSource = new SourceAggregator([subsquidProvider, rpcProvider])
  const eventIterator = aggregatedSource.from({
    startHeight: startHeight ? BigInt(startHeight) + 1n : deploymentBlock,
    endHeight,
    chunkSize: 10_000n
  })

  const events = await db.get<EVMBlock[]>('events') ?? []
  for await (const event of eventIterator) {
    events.push(event)
  }
  await Promise.all([
    db.set('latestHeight', endHeight.toString()),
    db.set('events', events)
  ])
  await writeSnapshot(db, snapshotFilename)
}

export { createSnapshot, writeSnapshot, restoreSnapshot }
