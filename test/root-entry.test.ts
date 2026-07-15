import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { SnapshotProvider } from '@railgun-reloaded/scanner'

import {
  artifactCIDFromBytes,
  decodeArtifact,
  encodeSnapshot
} from '../src/index.js'
import {
  decodeArtifact as decodeArtifactNode,
  encodeSnapshot as encodeSnapshotNode
} from '../src/node/index.js'

import { TEST_VECTOR_EVENTS3 } from './test-vectors.js'

const METADATA = {
  chainID: 1,
  startHeight: 15821476n,
  endHeight: 15821513n
}

const FIXED_ARTIFACT_FIXTURE = {
  cid: 'bafkreihcuzfubb4f6cuf7v7ru2vu7m4zitijurmjg2ltv66vsuhapgx7ty',
  hex: '1bf307006480ceb5205f0016c495871bfcdbadf6f50ad2c3d8f746b0474e4d852a5ac1a6a035bb5ffbb5b5ee3dde440638f0d9790f6c19f1f98613f6d99afbaea5b1a108105f64f1bcf4f3d80f3d66ce594c771e0201a018b15176420f668e7dff4a1dfe53ca93f929aba0c40a31a4eac3cbdd236387c66a8953862d12cf127856450506e3ca13cd536e22139cdc81c663669fc5b8335c348d838755ec45e96d7c7ce69e6e5c2645ce545b33397f5adda960add54bda46625d12d91cf5c1b2cff80cbd1f3500ce55f1ec7776f226d8624b5103a7d6c83e433cb1108bcced1bd22110e345a35008d09a25908816cf193a8afee35d7ef554bab8d85fbfac08f9b3ca5d4a357a2d3dae975f3d9994fa6df9f2239ece00ffc86c6f67d0543a0901189cd8c89e8de4c4315a242e652f95f2be4be48fbad168df96f46de4e47e9e810548c0ca6751040c0280ddfa7b6974197e5b7baf5c583c294c7faa53d09945e610e43187c3a04fa4979505f1595a140b15e0ed01235f641e2b19ad021bcf3558202780abadc0e2d55cff4b187104131c047c060886d372dc8951958417682015cd384887404c24928aa1517210c0b5898963d1a53b22b95977062115f09be5e304ed41bf072f58dd4327a704a24dc3cfb76d2ced4a8d5deffa733d53cc35b9341d8584d0f8ad468a445ba05872710eed59c8a2350b276692fe57a9bfb463047ece70e6aa66fe010377dd4ed58110207e402f19d818cad309b9cd7059fa907aec56e4232ab1cce24bce152cbd5af14355b3f78e8cd2ccc2d32642ddad678a025e97aabf05548e79b5b01fd3dd014bf89a6b18881de08d007856f51faf6986759d3a39f36df3d86774c6167859e686fc934e73494d47f2514532493ed12b3cf0354e3b2660092083998d00c4b432bb7d3ca40b16f3afbfffe32d75dca8afe7edbbc29ac8bd15e1c0675b6337892c884d8b5a59001546a2a1c9cc39df96ff726677a7ccdee3ae5323633e99d4e4897007f59daf7f3adc3fffac6372077d31be0b430129b41c04d0c36569a8dca991a658fb8bd91bd2c9abb9bdb194085fe337bda5a3f13b3a341601043d781cfbc22babec6e103f994fce8192f971a06b1d046c333cc387ff0d1fc822a209743cc8804036740645480f177948896b7e5f7041d31757358a69ee4043485c78fdf4e39d6789a7b654227f0468ad31cc31182484cc4500e3f27e3932be650ee5d1acf6d9cb6f01131c492b0c2e2c7dfb848ade6653e12d049079424dc0c7facd99471f8e47c2af8b6e5cff35ae7eb2b5bde4efebd09e6ccdae300480f2cd091d928a75c8ba66f7fa4681b8c6dc3741f9329b9cd3ec57692505a1f02b4488c767b94801e97890023290e420f0203307017cfcdcffe36fff4cd2d73fc76ca722860a8ea70d9fc7c01d46ee22f4f43a254ccc10c0c084222503e631c82bb3c4ba6c68d6a43f743b2668a3d43d8366a234fdfa9c692facacad75f150fb67bfd3a73dcf0de7095f427daab1436f8ca6bde7bee07e76d2cc98838993f4099dada832d7e632fd939f7947db7daf51fe59d9257d482ab90c8bb96ed88a9b75786b3ad41354cafccd9efefb88aae4ee244afc71a414181cb3b292efaf86bd445d6fba69632ed71f990ece9288f051be1b68692efa47275e3ded2db7734ac737bbee1798f852a2793d66f4d6f3ef9fa4e1bf19190fdcc6ff38fcf71f64c23fc4fc1db71c798e89b72e147c53cd53dcac6cdf56da3eb9ffa3b6d46dbb28eb93e5a5089273c726fd0a1eee9246b0a835a985b5bbdbe95d03bd6f969c32fcc11b602cf1a8e4f210fd4d6b0e90979ee648eeeb4d787c217b45ec460ba9840fc57a1e1b22f3c0e1efb9f11f6c8f5f64bc540b121ec98ca132f104908c59258d96a8301604a3b05efd46745aa5cde2050a54a5e49d366ff1044f9be9c3e1480692c2f4e7cce50c3d96d78798858f056a0f8b579643ae9dcfdedfdc4c50683aa7ed29d228ff8def80ff94cdd1b46e84764fb94ce4f75e5c3809baa284464213f31828482f3b41008acd411c3a0e0ab4588b88a65d1f1a2f6a75eeb8b9595eff471787161dd157632b454af6ccc7541f350d63414ac28b38341e49a0067873e166fb808b005231d5169e7b7962ad8197653a37a9062810e0ce02'
}

/**
 * Return the static compressed artifact fixture bytes.
 * @returns Fixture artifact bytes.
 */
function fixedArtifactBytes (): Uint8Array {
  return Uint8Array.from(Buffer.from(FIXED_ARTIFACT_FIXTURE.hex, 'hex'))
}

test('root decoder produces byte-identical output for a Node-encoded artifact', async () => {
  const encoded = encodeSnapshotNode(TEST_VECTOR_EVENTS3, METADATA)
  const cid = await artifactCIDFromBytes(encoded)

  const [rootDecoded, nodeDecoded] = await Promise.all([
    decodeArtifact(encoded, cid),
    decodeArtifactNode(encoded, cid)
  ])

  assert.deepStrictEqual(rootDecoded, nodeDecoded)
  assert.deepStrictEqual(rootDecoded.blocks, TEST_VECTOR_EVENTS3)
})

test('root decoder preserves a fixed artifact fixture', async () => {
  const encoded = fixedArtifactBytes()
  assert.equal(await artifactCIDFromBytes(encoded), FIXED_ARTIFACT_FIXTURE.cid)

  const decoded = await decodeArtifact(encoded, FIXED_ARTIFACT_FIXTURE.cid)

  assert.deepStrictEqual(decoded.blocks, TEST_VECTOR_EVENTS3)
})

test('scanner SnapshotProvider consumes the injected root decoder', async (t) => {
  const encoded = fixedArtifactBytes()
  const gateway = 'https://snapshot.test/ipfs/'

  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request): Promise<Response> => {
      assert.equal(String(input), gateway + FIXED_ARTIFACT_FIXTURE.cid)
      const body = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength
      ) as ArrayBuffer
      return new Response(body)
    }
  )

  const provider = new SnapshotProvider({
    ipfsHash: FIXED_ARTIFACT_FIXTURE.cid,
    gateways: [gateway],
    decodeArtifact
  })

  assert.equal(await provider.head(), METADATA.endHeight)
  const blocks = await Array.fromAsync(provider.from({
    startHeight: METADATA.startHeight,
    endHeight: METADATA.endHeight,
    liveSync: false
  }))

  assert.equal(blocks.length, TEST_VECTOR_EVENTS3.length)
  for (const [index, block] of blocks.entries()) {
    const expected = TEST_VECTOR_EVENTS3[index]!
    assert.equal(block.number, expected.number)
    assert.deepStrictEqual(block.hash, expected.hash)
    assert.equal(block.transactions.length, expected.transactions.length)
  }
})

test('root entry round-trips under the browser import condition', () => {
  const script = `
    import fs from 'node:fs/promises'
    import assert from 'node:assert/strict'
    import { fileURLToPath } from 'node:url'

    const nativeFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url

      if (url.startsWith('file:')) {
        const bytes = await fs.readFile(fileURLToPath(url))
        return new Response(bytes, {
          headers: { 'Content-Type': 'application/wasm' }
        })
      }

      return nativeFetch(input, init)
    }

    const { encodeSnapshot, decodeArtifact, artifactCIDFromBytes } =
      await import('@railgun-reloaded/snapshot')
    const { TEST_VECTOR_EVENTS3 } = await import('./test/test-vectors.js')

    const metadata = {
      chainID: 1,
      startHeight: 15821476n,
      endHeight: 15821513n
    }
    const encoded = await encodeSnapshot(TEST_VECTOR_EVENTS3, metadata)
    const cid = await artifactCIDFromBytes(encoded)
    const decoded = await decodeArtifact(encoded, cid)

    assert.deepStrictEqual(decoded.blocks, TEST_VECTOR_EVENTS3)
  `

  const result = spawnSync(
    process.execPath,
    ['--conditions=browser', '--input-type=module', '--eval', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8'
    }
  )

  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('root encoder output decodes through root and Node decoders', async () => {
  const encoded = await encodeSnapshot(TEST_VECTOR_EVENTS3, METADATA)
  const cid = await artifactCIDFromBytes(encoded)

  const [rootDecoded, nodeDecoded] = await Promise.all([
    decodeArtifact(encoded, cid),
    decodeArtifactNode(encoded, cid)
  ])

  assert.deepStrictEqual(rootDecoded, nodeDecoded)
  assert.deepStrictEqual(rootDecoded.blocks, TEST_VECTOR_EVENTS3)
})
