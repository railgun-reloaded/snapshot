/**
 * Returns the maximum of two bigint values.
 * @param a - The first bigint value.
 * @param b - The second bigint value.
 * @returns The larger of the two values.
 */
function maxBigInts (a: bigint, b: bigint) { return a > b ? a : b }
/**
 * Returns the minimum of two bigint values.
 * @param a - The first bigint value.
 * @param b - The second bigint value.
 * @returns The smaller of the two values.
 */
function minBigInts (a: bigint, b: bigint) { return a < b ? a : b }

/**
 * Normalizes a hex string by lowercasing it and padding with a leading zero if the length is odd.
 * Non-hex strings (without '0x' prefix) are returned as-is.
 * @param v - The string value to normalize.
 * @returns The normalized hex string.
 */
function normalizeHexString (v: string): string {
  if (!v.startsWith('0x')) return v // treat only explicit hex as hex
  let s = v.toLowerCase()
  if (s.length % 2 === 1) s = '0x0' + s.slice(2)
  return s
}

/**
 * Recursively canonicalizes a value by normalizing hex strings and sorting object keys.
 * Handles arrays, objects, and primitive values.
 * @param val - The value to canonicalize.
 * @returns The canonicalized value.
 */
function canonicalizeValue (val: any): any {
  if (Array.isArray(val)) return val.map(canonicalizeValue)
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(val)) out[k] = canonicalizeValue(val[k])
    return out
  }
  if (typeof val === 'string') return normalizeHexString(val)
  return val
}

export { maxBigInts, minBigInts, normalizeHexString, canonicalizeValue }
