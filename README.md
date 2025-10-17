# `@railgun-reloaded/snapshot`

> A package to create snapshot of railgun historical events

## Snapshot Spec (rsnap v1)

- Canonical artifact: a single uncompressed DAG-CBOR-encoded root object. Its CIDv1 (codec=dag-cbor, multihash=sha2-256) is the sole identity of a snapshot.
- Root schema [WIP](subject to change like FAFO-TXID)

### Encoding and transport: DAG-CBOR / CAR

#### DAG-CBOR

- Determinism: canonical map key ordering and stable binary encoding → identical bytes → identical CID for identical data.
- Compact and typed: efficient binary compression; integers/byte strings are explicit and unambiguous.

#### CAR

- We publish a CAR with the snapshot root set to the DAG-CBOR block’s CID. Importing this CAR on any node preserves the exact root CID.
- You can also publish the raw root block directly > consumers fetch by CID.

### How is the CID deterministic

- stable encoding: single DAG-CBOR implementation
- Structural validation: `entryCount` must match, `endHeight ≥ startHeight`, arrays preserve order, maps use string keys only.
- Identity: CIDv1(dag-cbor, sha2-256) over the exact `.rsnap` bytes; any mutation changes the CID.

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
    snapshotFilename: "ethereum-snapshot.rsnap",
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
  const restoredData = await restoreSnapshot("ethereum-snapshot.rsnap");

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
