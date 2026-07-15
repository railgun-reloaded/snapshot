enum NetworkName {
  Ethereum,
  Polygon,
  EthereumSepolia
}

const ENV = typeof process !== 'undefined' ? process.env : {}

const NETWORK_CONFIG = {
  [NetworkName.Ethereum]: {
    name: 'ethereum',
    proxyAddress: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
    deploymentBlock: 14737691n,
    subsquidURL: 'http://localhost:4350/graphql',
    rpcURL: ENV['RPC_ETH_URL']
  },
  [NetworkName.Polygon]: {
    name: 'polygon',
    proxyAddress: '0x19B620929f97b7b990801496c3b361CA5dEf8C71',
    deploymentBlock: 27803253n,
    subsquidURL: 'https://9de66b63-778a-4bfd-a169-6a82a122aef3.squids.live/squid-railgun-polygon-test@v1/api/graphql',
    rpcURL: ENV['RPC_POLY_URL']
  },
  [NetworkName.EthereumSepolia]: {
    name: 'ethereum-sepolia',
    proxyAddress: '0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea',
    deploymentBlock: 5784866n,
    subsquidURL: 'https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/graphql',
    rpcURL: ENV['RPC_SEPOLIA_URL']
  }
}

/**
 * Get NetworkConfig from chainID
 * @param chainID - Input chainID
 * @returns Network config for given chainID
 */
function getNetworkConfigFromChainID (chainID: number) {
  switch (chainID) {
    case 1:
      return NETWORK_CONFIG[NetworkName.Ethereum]
    case 137:
      return NETWORK_CONFIG[NetworkName.Polygon]
    case 11155111:
      return NETWORK_CONFIG[NetworkName.EthereumSepolia]
    default:
      throw new Error('Unknown chainID')
  }
}

export { NETWORK_CONFIG, NetworkName, getNetworkConfigFromChainID }
