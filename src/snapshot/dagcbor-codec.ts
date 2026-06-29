import { cborg, cborgTaglib, dagCbor } from '../lib/formats/index.js'

/**
 * Class for handling encoding/decoding of DAGCBOR data
 */
class DAGCBORCodec {
  /**
   * Encode a javascript object using DAGCBOR encoding
   * @param data - Input javascript object to encode
   * @returns - DAGCBOR encoded bytes of input
   */
  static encodeToBytes (data: Record<string, any>) {
    try {
      return cborg.encode(data, {
        ...dagCbor.encodeOptions,
        typeEncoders: {
          ...dagCbor.encodeOptions.typeEncoders,
          bigint: cborgTaglib.bigIntEncoder
        }
      })
    } catch (err) {
      throw new Error('Failed to encode data using DAGCBOR', { cause: err })
    }
  }

  /**
   * Decode DAGCBOR encoded bytes to object
   * @param data - Input bytes to decode
   * @returns - Decoded object
   */
  static decodeFromBytes<T>(data: Uint8Array) {
    try {
      return cborg.decode(dagCbor.toByteView(data), {
        ...dagCbor.decodeOptions,
        tags: {
          ...dagCbor.decodeOptions.tags,
          2: cborgTaglib.bigIntDecoder,
          3: cborgTaglib.bigNegIntDecoder
        }
      }) as T
    } catch (err) {
      throw new Error('Failed to decode data using DAGCBOR', { cause: err })
    }
  }
}

export { DAGCBORCodec }
