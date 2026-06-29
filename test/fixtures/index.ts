import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

/**
 * Load blockchain event data from the dump file
 * @returns BlockchainEventData representation of dump file
 */
export function loadBlockchainEvents (): BlockchainEventData {
  if (!eventData) {
    const dataPath = path.join(__dirname, 'events_dump.json')

    if (!fs.existsSync(dataPath)) {
      throw new Error(
        'Missing events dump needed to run tests\n' +
        'run \'npm run test:generate:events-dump\' first.\n'
      )
    }

    try {
      const rawData = fs.readFileSync(dataPath, 'utf8')
      const parsed = JSON.parse(rawData)

      if (Array.isArray(parsed)) {
        // squid format
        eventData = {
          metadata: {
            chainID: 1,
            startBlock: '0',
            endBlock: '0',
            description: 'Scanner dump data',
            scannedBlocks: parsed.length,
            blocksWithEvents: parsed.length,
            totalEvents: parsed.reduce((sum: number, block: any) =>
              sum + (block.transactions?.reduce((txSum: number, tx: any) =>
                txSum + (tx.actions?.flat().length ?? 0), 0) ?? 0), 0),
            extractedAt: new Date().toISOString(),
            networkConfig: {
              rpcURL: 'test',
              contractAddress: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
              deploymentBlock: '0'
            }
          },
          blocks: parsed,
          blockRange: parsed,
          fullDataset: parsed
        }
      } else {
        throw new Error('Unrecognized events dump format')
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          'Invalid JSON in events dump file\n' +
          'run \'npm run test:generate:events-dump\' first.\n' +
          `Error: ${error.message}`
        )
      }
      throw error
    }
  }
  return eventData!
}
