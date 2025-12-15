import dotenv from 'dotenv'
import { RPCProvider, SourceAggregator, SubsquidProvider } from 'fafo-scanner'
import type { EVMBlock } from 'fafo-scanner/src/models'
import { RPCConnectionManager } from 'fafo-scanner/src/sources/rpc'

import { RailgunDB } from './database'
import { createSnapshotFromDB, restoreSnapshot } from './snapshot'

dotenv.config()

/**
 * Return the larger of two bigints.
 * @param a - left-hand bigint
 * @param b - right-hand bigint
 * @returns The greater of `a` and `b`.
 */
function maxBigInts (a: bigint, b: bigint) {
  return a > b ? a : b
}
/**
 * Return the smaller of two bigints.
 * @param a - left-hand bigint
 * @param b - right-hand bigint
 * @returns The smaller of `a` and `b`.
 */
function minBigInts (a: bigint, b: bigint) {
  return a < b ? a : b
}

/**
 * Create snapshot of railgun event upto the latest height
 * @param createOptions - Snapshot create options
 * @param createOptions.chainID - Numeric chain identifier
 * @param createOptions.dbName - Name of database to create
 * @param createOptions.snapshotFilename - Filename of snapshot
 * @param createOptions.startHeight - StartHeight to sync event
 * @param createOptions.endHeight - EndHeight to sync event
 */
async function createSnapshot (createOptions: {
  chainID: number;
  dbName: string;
  snapshotFilename: string;
  startHeight?: bigint;
  endHeight?: bigint;
}) {
  const { chainID, dbName, snapshotFilename } = createOptions
  if (!chainID) throw new Error('ChainID is not defined')

  const { getNetworkConfigFromChainID } = require('./network-config')
  const { name: networkName, rpcURL, subsquidURL, deploymentBlock, proxyAddress } = getNetworkConfigFromChainID(chainID)

  if (!rpcURL) {
    throw new Error('Network RPC URL is not defined')
  }

  console.log('Creating snapshot for ', networkName)

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

  // @TODO may need to handle some type issues
  const events = await db.get<EVMBlock[]>('events') ?? []
  for await (const event of eventIterator) {
    events.push(event)
  }
  await Promise.all([
    db.set('latestHeight', endHeight.toString()),
    db.set('events', events)
  ])
  await createSnapshotFromDB(db, snapshotFilename)
}

export { createSnapshot, restoreSnapshot }
