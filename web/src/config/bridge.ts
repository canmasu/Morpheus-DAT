import { defineChain, type Chain } from 'viem';
import { LZ_BASE, LZ_BASE_SEPOLIA, LZ_ETHEREUM, LZ_MAINNET_CHAINS, LZ_SEPOLIA, LZ_TESTNET_CHAINS, type LzChain } from './lzChains';

export const lzHomeChains = () => [...LZ_MAINNET_CHAINS, ...LZ_TESTNET_CHAINS];

/** The chains a Partner can bridge from on this network. */
export const lzChainsOf = (net: { name: string }) => (net.name === 'mainnet' ? LZ_MAINNET_CHAINS : LZ_TESTNET_CHAINS);

export const lzBaseOf = (net: { name: string }) => (net.name === 'mainnet' ? LZ_BASE : LZ_BASE_SEPOLIA);

export const lzEthereumOf = (net: { name: string }) => (net.name === 'mainnet' ? LZ_ETHEREUM : LZ_SEPOLIA);

/** The verifiers a path between two chains requires: the first two they share. */
export function pathVerifiers(a: LzChain, b: LzChain) {
  return Object.keys(a.dvns).filter((n) => n in b.dvns).slice(0, 2);
}

export function viemChain(c: LzChain): Chain {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.native,
    rpcUrls: { default: { http: [c.rpc] } },
    ...(c.explorer ? { blockExplorers: { default: { name: 'Explorer', url: c.explorer } } } : {}),
  });
}

/** Base's own L1StandardBridge on Sepolia. ETH sent here arrives at the sender's address on Base Sepolia. */
export const BASE_SEPOLIA_BRIDGE = '0xfd0Bf71F60660E2f608ed56e1659C450eB113120';

/** Where to get gas on each testnet, by chain key in lzChains.ts. Official faucets first. */
export const TESTNET_FAUCETS: Record<string, { label: string; url: string }[]> = {
  'sepolia-testnet': [
    { label: 'Google', url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia' },
    { label: 'Alchemy', url: 'https://www.alchemy.com/faucets/ethereum-sepolia' },
  ],
  'base-sepolia': [
    { label: 'Google', url: 'https://cloud.google.com/application/web3/faucet/ethereum/base-sepolia' },
    { label: 'Alchemy', url: 'https://www.alchemy.com/faucets/base-sepolia' },
  ],
  'bsc-testnet': [{ label: 'BNB Chain', url: 'https://www.bnbchain.org/en/testnet-faucet' }],
  'arbitrum-sepolia': [{ label: 'Alchemy', url: 'https://www.alchemy.com/faucets/arbitrum-sepolia' }],
  'optimism-sepolia': [
    { label: 'Superchain', url: 'https://console.optimism.io/faucet' },
    { label: 'Alchemy', url: 'https://www.alchemy.com/faucets/optimism-sepolia' },
  ],
  'amoy-testnet': [
    { label: 'Polygon', url: 'https://faucet.polygon.technology/' },
    { label: 'Alchemy', url: 'https://www.alchemy.com/faucets/polygon-amoy' },
  ],
  'monad-testnet': [{ label: 'Alchemy', url: 'https://www.alchemy.com/faucets/monad-testnet' }],
  'robinhood-testnet': [
    { label: 'Robinhood', url: 'https://faucet.testnet.chain.robinhood.com/' },
    { label: 'Alchemy', url: 'https://www.alchemy.com/faucets/robinhood-testnet' },
  ],
  'arc-testnet': [{ label: 'Circle', url: 'https://faucet.circle.com/' }],
};
