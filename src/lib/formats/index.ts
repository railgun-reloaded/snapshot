import { getIPLD, initializeIPLD, isInitialized as isIPLDInitialized } from './ipld'
import { getMultiformats, initializeMultiformats, isInitialized as isMultiformatsInitialized } from './multiformats'

// dev-note;
// we don't really wanna change our commonjs ... thing is, most ipld/multiformats packages are esm only
// see; https://github.com/multiformats/js-multiformats/issues/237#issuecomment-1439242645
// so its either this, or every time we use any of the methods from those libs we need to do lazy import
// like const { foo }  = await require('@bar/foo')
// like literally every time
// so I'd thoguht probably this is cleaner and gives us the same flexibility for handling imports like we do everywhere else
// only con is that we need to run this function at  start (its ugly) (i know) (I want to remove trust me)
// alternative: ipfs-car ??
/**
 * Initialize Formats
 */
async function initializeFormats (): Promise<void> {
  await Promise.all([
    initializeMultiformats(),
    initializeIPLD()
  ])
}

/**
 * Get initialization status of formats
 * @returns  Return initialization status of formats
 */
function isFormatsInitialized (): boolean {
  return isMultiformatsInitialized() && isIPLDInitialized()
}

export { getMultiformats, getIPLD, isMultiformatsInitialized, isIPLDInitialized }
