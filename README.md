# `@railgun-reloaded/snapshot`

> A package to create snapshot of railgun historical events

## Snapshot Spec (rsnap)

- Canonical artifact: a single brotli-compressed blob containing a DAG-CBOR
  snapshot root object. Its CIDv1 uses codec `raw` (`0x55`) and multihash
  `sha2-256` over the exact compressed `.rsnap` bytes.
- Root schema [WIP](subject to change like FAFO-TXID)

### Encoding and transport: brotli / DAG-CBOR / raw IPFS block

#### Snapshot bytes

- The in-memory root object is encoded with deterministic DAG-CBOR.
- The DAG-CBOR bytes are then brotli-compressed into the `.rsnap` artifact.
- Consumers fetch the artifact bytes, verify the raw CID, decompress, DAG-CBOR
  decode, and validate the root schema.

#### CID and IPLD behavior

- The artifact CID labels the outer IPFS block as `raw`, not `dag-cbor`,
  because the addressed bytes are compressed opaque bytes.
- The artifact block is not IPLD-traversable. `ipfs dag get <artifact-cid>` is
  not the consumer contract; fetch the raw block bytes and pass them to
  `decodeArtifact` or `decodeSnapshot`.
- CAR exports/imports must use the same raw artifact CID as their root so
  codec-aware backends can import and serve the artifact without trying to
  DAG-CBOR-decode compressed bytes.

### How is the CID deterministic

- stable encoding: single DAG-CBOR implementation plus deterministic brotli
  settings
- Structural validation: `entryCount` must match, `endHeight ≥ startHeight`, arrays preserve order, maps use string keys only.
- Identity: CIDv1(raw, sha2-256) over the exact compressed `.rsnap` bytes; any mutation changes the CID.

### Artifact format

There is a single artifact format. The snapshot root carries `version` `1`, and
the artifact CID uses codec `raw` (`0x55`) over the exact compressed `.rsnap`
bytes. Consumers reject any other root `version` with `unsupported version <n>`.

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
