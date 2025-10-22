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

    if (!fs.existsSync(dataPath)) {
      throw new Error(
        `Missing events dump needed to run tests\n` +
        `run 'npm run test:generate:events-dump' first.\n`
      )
    }

    try {
      const rawData = fs.readFileSync(dataPath, 'utf8')
      const parsed = JSON.parse(rawData)

      // Validate the structure
      if (!parsed.metadata || !parsed.fullDataset || !Array.isArray(parsed.fullDataset)) {
        throw new Error(
          `Invalid events dump file format\n` +
          `run 'npm run test:generate:events-dump' first.\n`
        )
      }

      eventData = {
        ...parsed,
        blocks: parsed.fullDataset
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Invalid JSON in events dump file\n` +
          `run 'npm run test:generate:events-dump' first.\n` +
          `Error: ${error.message}`
        )
      }
      throw error
    }
  }
  return eventData!
}
