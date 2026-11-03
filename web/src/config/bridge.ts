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
