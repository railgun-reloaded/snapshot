# `@railgun-reloaded/snapshot`

> A package to create snapshot of railgun historical events

## Install

```sh
npm install @railgun-reloaded/snapshot
```

## Example Usage

### `createSnapshot`

```ts
import { createSnapshot } from "@railgun-reloaded/snapshot";

async function main() {
  await createSnapshot({
    chainID: 1, // Ethereum mainnet
    dbName: "railgun-events.db",
    snapshotFilename: "ethereum-snapshot.gz",
    startHeight: 14737691n, // Optional: override start height
    endHeight: 18500000n    // Optional: override end height
  });

  console.log("Snapshot created successfully!");
}

main().catch(console.error);
```

### `restoreSnapshot`

```ts
import { restoreSnapshot } from "@railgun-reloaded/snapshot";

async function main() {
  const restoredData = await restoreSnapshot("ethereum-snapshot.gz");

  if (restoredData) {
    console.log("Latest synced height:", restoredData.latestHeight);
    console.log("Number of events:", restoredData.events?.length || 0);
    console.log("Sample event:", restoredData.events?.[0]);
  }
}

main().catch(console.error);
```

#### Output

```sh
Latest synced height: 18500000
Number of events: 15420
Sample event: {
  blockNumber: 14737692n,
  blockHash: "0x1234...",
  transactionHash: "0x5678...",
  // ... other event data
}
```

## License

[MIT](LICENSE)
