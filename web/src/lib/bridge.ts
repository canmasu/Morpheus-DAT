import { type Abi, type Address, erc20Abi, pad, zeroAddress } from 'viem';
import * as A from '@/contracts/artifacts';
import { lzBaseOf, lzChainsOf, lzEthereumOf, viemChain } from '@/config/bridge';
import type { NetworkConfig } from '@/config/networks';
import type { LzChain } from '@/config/lzChains';
import { deploymentsOf } from './deployments';
import { publicClient, write } from './tx';
import { ulnAbi } from './bridgePlan';

export const registryOf = (net: NetworkConfig) => deploymentsOf(net.name).base?.bridgeRegistry;
export const ethRegistryOf = (net: NetworkConfig) => deploymentsOf(net.name).ethereum?.ethBridgeRegistry;

export const sendParam = (dstEid: number, to: Address, amount: bigint) => ({
  dstEid,
  to: pad(to),
  amountLD: amount,
  minAmountLD: amount,
  extraOptions: '0x' as const,
  composeMsg: '0x' as const,
  oftCmd: '0x' as const,
});

/** What a Farmer sees about a bridged OG Token, read live from the chains. */
export type BridgeInfo = {
  /** The chain this copy of the token is on: Base for MOR pools, Ethereum for the others. */
  here: LzChain;
  home: LzChain;
  /** Where the holder can send it. */
  destinations: LzChain[];
  linked: boolean;
  verifiers: number;
  ownerIsContract: boolean;
  /** False when another chain could not be read; `linked` and `ownerIsContract` then cover this chain only. */
  allChecked: boolean;
};

const hasCode = async (chain: Parameters<typeof publicClient>[0], a: Address) => {
  const code = await publicClient(chain).getCode({ address: a });
  return !!code && code !== '0x';
};

/** @param net the network itself, not its Base view */
export async function bridgeInfo(net: NetworkConfig, oft: Address, onBase: boolean): Promise<BridgeInfo | undefined> {
  const registry = onBase ? registryOf(net) : ethRegistryOf(net);
  if (!registry) return undefined;
  const here = onBase ? lzBaseOf(net) : lzEthereumOf(net);
  const sibling = onBase ? lzEthereumOf(net) : lzBaseOf(net);
  const hereChain = viemChain(here);
  const c = publicClient(hereChain);
  const [partner, homeEid, homeToken, adapter] = await c.readContract({ address: registry, abi: A.OGBridgeRegistry.abi, functionName: 'bridges', args: [oft] });
  if (partner === zeroAddress) return undefined;
  const home = lzChainsOf(net).find((x) => x.eid === homeEid);
  if (!home) return undefined;

  const o = { address: oft, abi: A.OGTokenOFT.abi } as const;
  const [homePeer, siblingPeer, owner] = await Promise.all([
    c.readContract({ ...o, functionName: 'peers', args: [homeEid] }),
    c.readContract({ ...o, functionName: 'peers', args: [sibling.eid] }),
    c.readContract({ ...o, functionName: 'owner' }),
  ]);
  const hasSibling = BigInt(siblingPeer) !== 0n && sibling.eid !== homeEid;
  const remotes = [home, ...(hasSibling ? [sibling] : [])];
  const configs = await Promise.all(
    remotes.flatMap((r) => [here.sendLib, here.receiveLib].map((lib) => c.readContract({ address: lib, abi: ulnAbi, functionName: 'getUlnConfig', args: [oft, r.eid] }))),
  );

  let linked = BigInt(homePeer) === BigInt(adapter);
  let ownerIsContract = await hasCode(hereChain, owner);
  let allChecked = true;
  try {
    const hc = viemChain(home);
    const a = { address: adapter, abi: A.OGTokenAdapter.abi } as const;
    const [back, homeOwner, token] = await Promise.all([
      publicClient(hc).readContract({ ...a, functionName: 'peers', args: [here.eid] }),
      publicClient(hc).readContract({ ...a, functionName: 'owner' }),
      publicClient(hc).readContract({ ...a, functionName: 'token' }),
    ]);
    linked = linked && BigInt(back) === BigInt(oft) && token.toLowerCase() === homeToken.toLowerCase();
    ownerIsContract = ownerIsContract && (await hasCode(hc, homeOwner));
  } catch {
    // an unreachable public RPC should not hide the pool: say what could be checked
    allChecked = false;
  }
  if (hasSibling) {
    try {
      const sc = viemChain(sibling);
      const siblingOft = `0x${siblingPeer.slice(-40)}` as Address;
      const back = await publicClient(sc).readContract({ address: siblingOft, abi: A.OGTokenOFT.abi, functionName: 'peers', args: [here.eid] });
      linked = linked && BigInt(back) === BigInt(oft);
    } catch {
      allChecked = false;
    }
  }
  return { here, home, destinations: remotes, linked, verifiers: Math.min(...configs.map((x) => x.requiredDVNCount)), ownerIsContract, allChecked };
}

export const ogBalance = (here: LzChain, oft: Address, who: Address) =>
  publicClient(viemChain(here)).readContract({ address: oft, abi: erc20Abi, functionName: 'balanceOf', args: [who] });

/** LayerZero moves amounts with 6 decimals, so anything finer stays behind. */
export const withoutDust = (amount: bigint, decimals: number) => {
  const unit = 10n ** BigInt(Math.max(decimals - 6, 0));
  return amount - amount % unit;
};

export const quoteBridge = (here: LzChain, oft: Address, to: LzChain, me: Address, amount: bigint) =>
  publicClient(viemChain(here)).readContract({ address: oft, abi: A.OGTokenOFT.abi, functionName: 'quoteSend', args: [sendParam(to.eid, me, amount), false] });

export async function sendBridge(here: LzChain, oft: Address, to: LzChain, me: Address, amount: bigint) {
  const fee = await quoteBridge(here, oft, to, me, amount);
  return write(viemChain(here), me, oft, A.OGTokenOFT.abi as Abi, 'send', [sendParam(to.eid, me, amount), fee, me], fee.nativeFee);
}
