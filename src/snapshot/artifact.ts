import type { RailgunDB } from '../lib/database/index.js'

import type {
  EncodeSnapshotBlock,
  EncodeSnapshotMetadata
} from './codec.js'
import {
  BROTLI_QUALITY,
  MAX_DECOMPRESSED_SIZE,
  decodeSnapshotContent,
  encodeSnapshotContent,
  verifyArtifactCID
} from './codec.js'
import type { Snapshot } from './types.js'

import {
  compressSnapshotBytes,
  decompressSnapshotBytes
} from '#snapshot-brotli'

/**
 * Decode a verified snapshot artifact from in-memory bytes.
 * @param bytes - Compressed snapshot artifact bytes.
 * @param expectedCid - CID the bytes must content-address to.
 * @returns Decoded and validated snapshot.
 */
async function decodeArtifact (
  bytes: Uint8Array,
  expectedCid: string
): Promise<Snapshot> {
  await verifyArtifactCID(bytes, expectedCid)

  const decompressed = await decompressSnapshotBytes(bytes, {
    maxOutputLength: MAX_DECOMPRESSED_SIZE
  })
  return decodeSnapshotContent(decompressed)
}

/**
 * Encode railgun blocks into compressed snapshot artifact bytes.
 * @param blocks - Input blocks to encode.
 * @param metadata - Chain and block range metadata.
 * @returns Encoded `.rsnap` bytes.
 */
async function encodeSnapshot (
  blocks: EncodeSnapshotBlock[],
  metadata: EncodeSnapshotMetadata
): Promise<Uint8Array> {
  return compressSnapshotBytes(encodeSnapshotContent(blocks, metadata), {
    quality: BROTLI_QUALITY
  })
}

/**
 * Filter the data from DB in the range of [startHeight, endHeight] and create
 * compressed snapshot artifact bytes.
 * @param db - Encode snapshot from DB.
 * @param metadata - Chain and block range metadata.
 * @returns Encoded `.rsnap` bytes.
 */
async function encodeSnapshotFromDB (
  db: RailgunDB,
  metadata: EncodeSnapshotMetadata
): Promise<Uint8Array> {
  const blocks = await db.get<EncodeSnapshotBlock[]>('blocks') ?? []
  return encodeSnapshot(blocks, metadata)
}

export { decodeArtifact, encodeSnapshot, encodeSnapshotFromDB }
export type { EncodeSnapshotMetadata }
