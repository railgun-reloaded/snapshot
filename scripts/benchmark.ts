import { EVMBlock, SubsquidProvider } from 'fafo-scanner';
import { getNetworkConfigFromChainID, initializeFormats, RailgunDB } from '../src'
import zlib from 'zlib'
import fs from 'fs'

const chainID = 1;

async function createSnapshot(filename: string, cbor: any, brotliOptions: any) {
    const config = getNetworkConfigFromChainID(chainID)
    const { subsquidURL } = config

    const startHeight = config.deploymentBlock

    const subsquidProvider = new SubsquidProvider(subsquidURL)
    const db = new RailgunDB('tempdb')

    const endHeight = await subsquidProvider.head()

    if (startHeight > endHeight) {
        throw new Error(`[benchmark]: invalid height range: startHeight (${startHeight}) cannot be greater than endHeight (${endHeight})`)
    }
    console.log(`[benchmark]: subsquidProvider latest height: ${endHeight}`)


    const eventIterator = subsquidProvider.from({
        startHeight: BigInt(startHeight),
        liveSync: false,
        endHeight,
        chunkSize: 5_000n
    })

    const events = []
    console.log(`[benchmark]: starting with ${events.length} existing events in DB`)

    for await (const event of eventIterator) {
        events.push(event)
    }
    console.log('[benchmark]: updating db')
    db.set("events", events);

    await initializeFormats();

    let totalTime = 0;
    /*
    const start = performance.now();
    const encoded = cbor.encode(events)
    console.log(`[benchmark]: encode time: `, (performance.now() - start) / 1000, 's')


    await pipeline(
        Readable.from([encoded]),
        zlib.createBrotliCompress(brotliOptions),
        createWriteStream(filename)
    );
    const end = performance.now();
    const delta = (end - start) / 1000;
    console.log(`[benchmark]: total time taken: ${delta}s`)
    totalTime += delta;
    */
    const start = performance.now();
    const encoded = cbor.encode(events)
    console.log(`[benchmark]: encode time: `, (performance.now() - start) / 1000, 's')

    const compressBegin = performance.now();
    const compressed = zlib.brotliCompressSync(encoded, brotliOptions);

    console.log(`[benchmark]: compression time: `, (performance.now() - compressBegin) / 1000, 's')
    const writeBegin = performance.now();
    fs.writeFileSync(filename, compressed)
    console.log(`[benchmark]: write time: `, (performance.now() - writeBegin) / 1000, 's')
    const end = performance.now();
    const delta = (end - start) / 1000;
    console.log(`[benchmark]: total time taken: ${delta}s`)
    totalTime += delta;
    const stats = fs.statSync('output.br');
    console.log(`[benchmark]: compressed size: ${stats.size / (1025 * 1024)}mb`);
}

async function readSnapshot(filename: string, cbor: any, brotliOptions: any) {
    const content = fs.readFileSync(filename);
    const decompressed = zlib.brotliDecompressSync(content, brotliOptions)
    return cbor.decode(decompressed) as EVMBlock[];
}

async function benchmark() {
    const [cbor] = await Promise.all([
        import('@ipld/dag-cbor'),
    ])
    const brotliOptions = {
        chunkSize: 256 * 1024,
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 6
        }
    }
    const filename = 'snapshot.br';

    readSnapshot(filename, cbor, brotliOptions)
}

if (require.main === module) {
    benchmark().catch(error => {
        console.error('[benchmark]: script failed:', error)
        process.exit(1)
    })
}

export { createSnapshot, readSnapshot }
