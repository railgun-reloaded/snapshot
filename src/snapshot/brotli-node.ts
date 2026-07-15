import zlib from 'node:zlib'

type BrotliCompressOptions = {
  quality: number
}

type BrotliDecompressOptions = {
  maxOutputLength: number
}

/**
 * Compress snapshot content with Node zlib brotli.
 * @param bytes - Uncompressed DAG-CBOR bytes.
 * @param options - Brotli compression options.
 * @returns Compressed artifact bytes.
 */
async function compressSnapshotBytes (
  bytes: Uint8Array,
  options: BrotliCompressOptions
): Promise<Uint8Array> {
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: options.quality
    }
  })
}

/**
 * Decompress snapshot artifact bytes with Node zlib brotli.
 * @param bytes - Compressed artifact bytes.
 * @param options - Brotli decompression options.
 * @returns Uncompressed DAG-CBOR bytes.
 */
async function decompressSnapshotBytes (
  bytes: Uint8Array,
  options: BrotliDecompressOptions
): Promise<Uint8Array> {
  return zlib.brotliDecompressSync(bytes, {
    maxOutputLength: options.maxOutputLength
  })
}

export { compressSnapshotBytes, decompressSnapshotBytes }
