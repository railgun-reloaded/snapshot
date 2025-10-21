function maxBigInts (a: bigint, b: bigint) { return a > b ? a : b }
function minBigInts (a: bigint, b: bigint) { return a < b ? a : b }

function normalizeHexString (v: string): string {
  if (!v.startsWith('0x')) return v // treat only explicit hex as hex
  let s = v.toLowerCase()
  if (s.length % 2 === 1) s = '0x0' + s.slice(2)
  return s
}

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

export { maxBigInts, minBigInts, normalizeHexString, canonicalizeValue}
