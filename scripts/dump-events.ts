

const fs = require('fs')
const path = require('path')

import { SubsquidProvider } from 'fafo-scanner'
import { getNetworkConfigFromChainID } from '../src/config'
import { RailgunDB } from '../src/lib/database'
import { minBigInts } from '../src/snapshot/utils'

require('dotenv').config({ path: path.join(__dirname, '../.env') })

async function eventsDump(options: any) {
  const {
    chainID = 1,
    startBlock = 17000000n,
    endBlock = 17010000n,
    outputFile = '../test/fixtures/events_dump.json'
  } = options

  if (!chainID) throw new Error('[events-dump]: chainID is not defined')

  try {


    const { rpcURL, subsquidURL, deploymentBlock, proxyAddress } = getNetworkConfigFromChainID(chainID)

    if (!rpcURL) {
      throw new Error('[events-dump]: network RPC URL is not defined')
    }

    // const connectionManager = new RPCConnectionManager(4)
    //const rpcProvider = new RPCProvider(proxyAddress as `0x${string}`, rpcURL, connectionManager)
    const subsquidProvider = new SubsquidProvider(subsquidURL)

    const db = new RailgunDB()
    const lastScannedHeight = await db.get<string>('latestHeight')

    let startHeight = lastScannedHeight ? BigInt(lastScannedHeight) + 1n : BigInt(deploymentBlock)
    startHeight = startBlock

    const latestHeight = await subsquidProvider.head()
    const endHeight = endBlock ? minBigInts(endBlock, latestHeight) : latestHeight

    if (startHeight > endHeight) {
      throw new Error(`'[events-dump]: invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
    }

    const subsquidHead = await subsquidProvider.head()
    console.log(`'[events-dump]: subsquidProvider latest height: ${subsquidHead}`)

   
    const eventIterator = subsquidProvider.from({
      startHeight: BigInt(startHeight),
      liveSync: false,
      endHeight,
      chunkSize: 5_000n
    })

    const events = await db.get<any[]>('events') ?? []
    console.log(`'[events-dump]: starting with ${events.length} existing events in DB`)

    let newEventCount = 0
    for await (const event of eventIterator) {
      events.push(event)
      newEventCount++
    }

    fs.writeFileSync(outputFile, JSON.stringify(events, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2))

  } catch (error) {
    console.error('[events-dump]: failed to generate events dump:', error)
    throw error
  }
}

if (require.main === module) {
  eventsDump({}).catch(error => {
    console.error('[events-dump]: script failed:', error)
    process.exit(1)
  })
}

module.exports = { eventsDump }
