import brotliPromise from 'brotli-wasm'

type BrotliCompressOptions = {
  quality: number
}

type BrotliDecompressOptions = {
  maxOutputLength: number
}

/**
 * Compress snapshot content with the browser-compatible brotli WASM runtime.
 * @param bytes - Uncompressed DAG-CBOR bytes.
 * @param options - Brotli compression options.
 * @returns Compressed artifact bytes.
 */
async function compressSnapshotBytes (
  bytes: Uint8Array,
  options: BrotliCompressOptions
): Promise<Uint8Array> {
  const brotli = await brotliPromise
  return brotli.compress(bytes, { quality: options.quality })
}

/**
 * Decompress snapshot artifact bytes with the browser-compatible brotli WASM runtime.
 * @param bytes - Compressed artifact bytes.
 * @param options - Brotli decompression options.
 * @returns Uncompressed DAG-CBOR bytes.
 */
async function decompressSnapshotBytes (
  bytes: Uint8Array,
  options: BrotliDecompressOptions
): Promise<Uint8Array> {
  const brotli = await brotliPromise
  const decompressed = brotli.decompress(bytes)
  if (decompressed.length > options.maxOutputLength) {
    throw new Error(
      `Snapshot artifact exceeds max decompressed size ${options.maxOutputLength}`
    )
  }
  return decompressed
}

export { compressSnapshotBytes, decompressSnapshotBytes }
