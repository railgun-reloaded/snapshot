import { test } from 'brittle'

import { createSnapshot } from '../src'
import { restoreSnapshot } from '../src/snapshot'
test('Should generate and restore snapshot [Ethereum]', async () => {
  await createSnapshot({
    chainID: 1,
    dbName: 'railgun.db',
    snapshotFilename: 'rg-snapshot.gz',
    startHeight: 14751290n,
    endHeight: 14768554n
  }
  )
})

test('Should restore snapshot [Ethereum]', { timeout: 300_000 }, async () => {
  await restoreSnapshot('rg-snapshot.gz')
})
