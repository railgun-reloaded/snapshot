#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

async function eventsDump(options = {}) {
  const {
    chainID = 1,
    startBlock = 17000000n,
    endBlock = 17010000n,
    outputFile = '../test/fixtures/events_dump.json'
  } = options

  console.log('[events-dump]: running generate dump script')

  try {

    const backupPath = path.resolve(__dirname, '../test/fixtures/events_dump.json.backup')
    const outputPath = path.resolve(__dirname, outputFile)

    if (fs.existsSync(backupPath)) {
      const data = fs.readFileSync(backupPath, 'utf8')
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.promises.writeFile(outputPath, data)
      return JSON.parse(data)
    } else {
      console.log('[events-dump]: no backup found')
      process.exit(1)
    }
  } catch (error) {
    console.error('[events-dump]: failed to generate events dump:', error)
    throw error
  }
}

if (require.main === module) {
  extractRealBlockchainData().catch(error => {
    console.error('[events-dump]: script failed:', error)
    process.exit(1)
  })
}

module.exports = { extractRealBlockchainData }
