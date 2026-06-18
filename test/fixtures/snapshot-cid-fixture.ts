// Shared producer/consumer CID vector. This value is duplicated verbatim in
// scanner/test/fixtures/snapshot-cid-fixture.ts and MUST stay byte-identical:
// each repo asserts its own CID helper reproduces `cid` from `artifactHex`, so
// any drift between the two implementations fails that repo's parity test.
const SNAPSHOT_CID_FIXTURE = {
  artifactHex: '7261696c67756e2d736e617073686f742d6369642d7631',
  cid: 'bafyreigennh5c6abpgadzpwjooykj67jvbii5cl5hjjhzq5dtesl3rgqgu'
} as const

export { SNAPSHOT_CID_FIXTURE }
