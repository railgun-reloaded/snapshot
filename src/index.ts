import dotenv from 'dotenv'
import { RPCProvider, SourceAggregator, SubsquidProvider } from 'fafo-scanner'
import type { EVMBlock } from 'fafo-scanner/src/models'
import { RPCConnectionManager } from 'fafo-scanner/src/sources/rpc'

import { SnapshotDB } from './snapshot-database'

dotenv.config()

/**
 * Create snapshot of railgun event upto the latest height
 */
async function createSnapshot () {
  const chainID = Number(process.env['CHAIN_ID'])
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

  const db = new SnapshotDB('railgun.db')
  const startHeight = await db.get<string>('latestHeight')
  const endHeight = await rpcProvider.head()

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

  await db.createSnapshot()
}

createSnapshot()
