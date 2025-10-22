import fs from 'fs'
import path from 'path'

// todo: see if we actually need this or we can do a generic type to import this
// anyway its mostly just to work around a json dump of events
interface BlockchainEventData {
  metadata: {
    chainID: number
    startBlock: string
    endBlock: string
    description: string
    scannedBlocks: number
    blocksWithEvents: number
    totalEvents: number
    extractedAt: string
    networkConfig: {
      rpcURL: string
      contractAddress: string
      deploymentBlock: string
    }
  }
  blocks: any[]
  blockRange: any[]
  fullDataset: any[]
}

let eventData: BlockchainEventData | null = null

export function loadBlockchainEvents(): BlockchainEventData {
  if (!eventData) {
    const dataPath = path.join(__dirname, 'events_dump.json')
    const rawData = fs.readFileSync(dataPath, 'utf8')
    const parsed = JSON.parse(rawData)
    eventData = {
      ...parsed,
      blocks: parsed.fullDataset
    }
  }
  return eventData!
}
