enum NetworkName {
  Ethereum,
  Polygon
}

function getNetworkConfig() {
  return {
    [NetworkName.Ethereum]: {
      name: 'ethereum',
      proxyAddress: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
      deploymentBlock: 14737691n,
      subsquidURL: 'https://378c7df9-13ab-48ef-a7fb-68f71af5fc6f.squids.live/squid-railgun-ethereum-test@v1/api/graphql',
      rpcURL: process.env['RPC_ETH_URL']
    },
    [NetworkName.Polygon]: {
      name: 'polygon',
      proxyAddress: '0x19B620929f97b7b990801496c3b361CA5dEf8C71',
      deploymentBlock: 27803253n,
      subsquidURL: 'https://9de66b63-778a-4bfd-a169-6a82a122aef3.squids.live/squid-railgun-polygon-test@v1/api/graphql',
      rpcURL: process.env['RPC_POLY_URL']
    }
  }
}

/**
 * Get NetworkConfig from chainID
 * @param chainID - Input chainID
 * @returns Network config for given chainID
 */
function getNetworkConfigFromChainID (chainID: number) {
  const NETWORK_CONFIG = getNetworkConfig()
  switch (chainID) {
    case 1:
      return NETWORK_CONFIG[NetworkName.Ethereum]
    case 137:
      return NETWORK_CONFIG[NetworkName.Polygon]
    default:
      throw new Error('Unknown chainID')
  }
}

export { getNetworkConfig as NETWORK_CONFIG, NetworkName, getNetworkConfigFromChainID }
