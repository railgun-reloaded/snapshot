import { getIPLD } from '../lib/formats'

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
      const { dagCbor } = getIPLD()
      return dagCbor.encode(data)
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
      const { dagCbor } = getIPLD()
      return dagCbor.decode(data) as T
    } catch (err) {
      throw new Error('Failed to decode data using DAGCBOR', { cause: err })
    }
  }
}

export { DAGCBORCodec }
