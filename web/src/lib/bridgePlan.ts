import { type Abi, type Address, type Hash, type TransactionReceipt, encodeAbiParameters, erc20Abi, pad, parseAbi, parseEventLogs } from 'viem';
import * as A from '@/contracts/artifacts';
import type { LzChain } from '@/config/lzChains';
import { pathVerifiers } from '@/config/bridge';

/** Same steps for the website and scripts/dry-run-bridge.ts. Everything is signed by the Partner's wallet.
 * Three possible nodes: the adapter on the token's home chain, the OFT on Base (MOR pools) and, optionally, the OFT on
 * Ethereum (stETH and stablecoin pools). Every pair is linked, so Alpha Coins can move between any two of them. */

const endpointAbi = parseAbi([
  'struct SetConfigParam { uint32 eid; uint32 configType; bytes config; }',
  'function setConfig(address oapp, address lib, SetConfigParam[] params)',
  'function getSendLibrary(address sender, uint32 eid) view returns (address)',
  'function getReceiveLibrary(address receiver, uint32 eid) view returns (address lib, bool isDefault)',
  'function setSendLibrary(address oapp, uint32 eid, address lib)',
  'function setReceiveLibrary(address oapp, uint32 eid, address lib, uint256 gracePeriod)',
]);
export const ulnAbi = parseAbi([
  'struct UlnConfig { uint64 confirmations; uint8 requiredDVNCount; uint8 optionalDVNCount; uint8 optionalDVNThreshold; address[] requiredDVNs; address[] optionalDVNs; }',
  'function getUlnConfig(address oapp, uint32 remoteEid) view returns (UlnConfig)',
]);

const ULN_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'confirmations', type: 'uint64' },
      { name: 'requiredDVNCount', type: 'uint8' },
      { name: 'optionalDVNCount', type: 'uint8' },
      { name: 'optionalDVNThreshold', type: 'uint8' },
      { name: 'requiredDVNs', type: 'address[]' },
      { name: 'optionalDVNs', type: 'address[]' },
    ],
  },
] as const;
const EXECUTOR_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'maxMessageSize', type: 'uint32' },
      { name: 'executor', type: 'address' },
    ],
  },
] as const;

const CONFIG_EXECUTOR = 1;
const CONFIG_ULN = 2;
const MAX_MESSAGE_SIZE = 10_000;
/** Used only if LayerZero has no default for the path. */
const FALLBACK_CONFIRMATIONS = 20n;
const SEND = 1;
/** Executor gas for delivering one OFT message. */
const LZ_RECEIVE_GAS = 200_000n;

/** LayerZero "type 3" options: run lzReceive with LZ_RECEIVE_GAS. */
export const SEND_OPTIONS = `0x000301001101${LZ_RECEIVE_GAS.toString(16).padStart(32, '0')}` as `0x${string}`;

/** LayerZero requires verifier addresses in ascending order. */
const sorted = (a: readonly Address[]) => [...a].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));

export type Side = 'home' | 'base' | 'eth';

export type BridgeParams = {
  home: LzChain;
  base: LzChain;
  /** Absent when the Partner only funds MOR pools, or when the token already lives on Ethereum. */
  eth?: LzChain;
  registry: Address;
  ethRegistry?: Address;
  token: Address;
  name: string;
  symbol: string;
  termsHash: Hash;
  wallet: Address;
  /** Who owns each side after setup: the wallet itself on testnet, a multisig on mainnet. */
  homeOwner: Address;
  baseOwner: Address;
  ethOwner?: Address;
};

export type BridgeResults = { adapter?: Address; oft?: Address; ethOft?: Address; done: Record<string, boolean> };

export type BridgeCtx = {
  p: BridgeParams;
  r: BridgeResults;
  deploy: (side: Side, artifact: { abi: Abi; bytecode: `0x${string}` }, args: unknown[], label: string) => Promise<Address>;
  write: (side: Side, address: Address, abi: Abi, fn: string, args: unknown[], label: string) => Promise<TransactionReceipt>;
  read: (side: Side, address: Address, abi: Abi, fn: string, args: unknown[]) => Promise<unknown>;
  /** Runs a call from the Partner's wallet without sending it. */
  simulate: (side: Side, address: Address, abi: Abi, fn: string, args: unknown[]) => Promise<unknown>;
};

export type BridgeStep = {
  id: string;
  side: Side;
  title: string;
  detail: string;
  skip?: (p: BridgeParams) => boolean;
  run: (c: BridgeCtx) => Promise<void>;
};

const SIDE_NAME: Record<Side, string> = { home: 'home chain', base: 'Base', eth: 'Ethereum' };

const chainOf = (p: BridgeParams, side: Side) => (side === 'home' ? p.home : side === 'base' ? p.base : p.eth!);
const oappOf = (r: BridgeResults, side: Side) => (side === 'home' ? r.adapter! : side === 'base' ? r.oft! : r.ethOft!);
const abiOf = (side: Side) => (side === 'home' ? A.OGTokenAdapter.abi : A.OGTokenOFT.abi) as Abi;
const sidesOf = (p: BridgeParams): Side[] => (p.eth ? ['home', 'base', 'eth'] : ['home', 'base']);
const remotesOf = (p: BridgeParams, side: Side) => sidesOf(p).filter((s) => s !== side);

/** The verifiers on `side`'s chain for its path to `remote`. */
const dvnsOn = (p: BridgeParams, side: Side, remote: Side) => {
  const here = chainOf(p, side);
  return pathVerifiers(here, chainOf(p, remote)).map((n) => here.dvns[n]);
};

/** The number of blocks to wait on the sending chain. Both ends of a path must agree on it. */
async function confirmations(c: BridgeCtx, from: Side, to: Side): Promise<bigint> {
  try {
    const cfg = (await c.read(from, chainOf(c.p, from).sendLib, ulnAbi as Abi, 'getUlnConfig', [oappOf(c.r, from), chainOf(c.p, to).eid])) as {
      confirmations: bigint;
    };
    return cfg.confirmations > 0n ? cfg.confirmations : FALLBACK_CONFIRMATIONS;
  } catch {
    return FALLBACK_CONFIRMATIONS;
  }
}

const ulnConfig = (conf: bigint, dvns: readonly Address[]) =>
  encodeAbiParameters(ULN_TUPLE, [
    { confirmations: conf, requiredDVNCount: dvns.length, optionalDVNCount: 0, optionalDVNThreshold: 0, requiredDVNs: sorted(dvns), optionalDVNs: [] },
  ]);

const noEth = (p: BridgeParams) => !p.eth;

const peerStep = (side: Side, remote: Side): BridgeStep => ({
  id: `${side}Peer_${remote}`,
  side,
  title: `Link ${SIDE_NAME[side]} to ${SIDE_NAME[remote]}`,
  detail: `Only your contract on ${SIDE_NAME[remote]} can send messages here`,
  skip: side === 'eth' || remote === 'eth' ? noEth : undefined,
  run: async (c) => {
    await c.write(side, oappOf(c.r, side), abiOf(side), 'setPeer', [chainOf(c.p, remote).eid, pad(oappOf(c.r, remote))], 'Link bridge');
  },
});

const configSteps = (side: Side): BridgeStep[] => {
  const skip = side === 'eth' ? noEth : undefined;
  return [
    {
      id: `${side}Options`,
      side,
      skip,
      title: `Set delivery gas (${SIDE_NAME[side]})`,
      detail: 'So a bridge message cannot be sent with too little gas to arrive',
      run: async (c) => {
        const options = remotesOf(c.p, side).map((r) => ({ eid: chainOf(c.p, r).eid, msgType: SEND, options: SEND_OPTIONS }));
        await c.write(side, oappOf(c.r, side), abiOf(side), 'setEnforcedOptions', [options], 'Set delivery gas');
      },
    },
    {
      id: `${side}Send`,
      side,
      skip,
      title: `Require verifiers on sends (${SIDE_NAME[side]})`,
      detail: 'Every outgoing message needs all required verifiers',
      run: async (c) => {
        const here = chainOf(c.p, side);
        const oapp = oappOf(c.r, side);
        const params = [];
        for (const r of remotesOf(c.p, side)) {
          const eid = chainOf(c.p, r).eid;
          const lib = (await c.read(side, here.endpoint, endpointAbi as Abi, 'getSendLibrary', [oapp, eid])) as Address;
          if (lib.toLowerCase() !== here.sendLib.toLowerCase()) {
            await c.write(side, here.endpoint, endpointAbi as Abi, 'setSendLibrary', [oapp, eid, here.sendLib], 'Set send library');
          }
          params.push(
            { eid, configType: CONFIG_EXECUTOR, config: encodeAbiParameters(EXECUTOR_TUPLE, [{ maxMessageSize: MAX_MESSAGE_SIZE, executor: here.executor }]) },
            { eid, configType: CONFIG_ULN, config: ulnConfig(await confirmations(c, side, r), dvnsOn(c.p, side, r)) },
          );
        }
        await c.write(side, here.endpoint, endpointAbi as Abi, 'setConfig', [oapp, here.sendLib, params], 'Require verifiers (send)');
      },
    },
    {
      id: `${side}Receive`,
      side,
      skip,
      title: `Require verifiers on receipts (${SIDE_NAME[side]})`,
      detail: 'Every incoming message needs all required verifiers',
      run: async (c) => {
        const here = chainOf(c.p, side);
        const oapp = oappOf(c.r, side);
        const params = [];
        for (const r of remotesOf(c.p, side)) {
          const eid = chainOf(c.p, r).eid;
          const [lib] = (await c.read(side, here.endpoint, endpointAbi as Abi, 'getReceiveLibrary', [oapp, eid])) as [Address, boolean];
          if (lib.toLowerCase() !== here.receiveLib.toLowerCase()) {
            await c.write(side, here.endpoint, endpointAbi as Abi, 'setReceiveLibrary', [oapp, eid, here.receiveLib, 0n], 'Set receive library');
          }
          params.push({ eid, configType: CONFIG_ULN, config: ulnConfig(await confirmations(c, r, side), dvnsOn(c.p, side, r)) });
        }
        await c.write(side, here.endpoint, endpointAbi as Abi, 'setConfig', [oapp, here.receiveLib, params], 'Require verifiers (receive)');
      },
    },
  ];
};

const handOver = (side: Side): BridgeStep[] => {
  const target = (p: BridgeParams) => (side === 'home' ? p.homeOwner : side === 'base' ? p.baseOwner : p.ethOwner!);
  const skip = (p: BridgeParams) => (side === 'eth' && !p.eth) || target(p).toLowerCase() === p.wallet.toLowerCase();
  return [
    {
      id: `${side}Delegate`,
      side,
      title: `Give LayerZero settings to your multisig (${SIDE_NAME[side]})`,
      detail: 'The multisig alone can change verifiers from now on',
      skip,
      run: async (c) => {
        await c.write(side, oappOf(c.r, side), abiOf(side), 'setDelegate', [target(c.p)], 'Hand over settings');
      },
    },
    {
      id: `${side}Owner`,
      side,
      title: `Give ownership to your multisig (${SIDE_NAME[side]})`,
      detail: 'Your wallet can no longer change the bridge',
      skip,
      run: async (c) => {
        await c.write(side, oappOf(c.r, side), abiOf(side), 'transferOwnership', [target(c.p)], 'Hand over ownership');
      },
    },
  ];
};

const deployOft = (side: 'base' | 'eth'): BridgeStep => ({
  id: side === 'base' ? 'oft' : 'ethOft',
  side,
  title: side === 'base' ? 'Deploy your token on Base and record the terms' : 'Deploy your token on Ethereum and record the terms',
  detail: 'Supply starts at zero and only exists through your bridge',
  skip: side === 'eth' ? noEth : undefined,
  run: async (c) => {
    const receipt = await c.write(
      side,
      side === 'base' ? c.p.registry : c.p.ethRegistry!,
      A.OGBridgeRegistry.abi as Abi,
      'createOft',
      [c.p.name, c.p.symbol, c.p.home.eid, c.p.token, c.r.adapter, c.p.termsHash],
      `Deploy token on ${SIDE_NAME[side]}`,
    );
    const [ev] = parseEventLogs({ abi: A.OGBridgeRegistry.abi, logs: receipt.logs, eventName: 'BridgeCreated' });
    if (!ev) throw new Error('BridgeCreated event not found');
    if (side === 'base') c.r.oft = ev.args.oft;
    else c.r.ethOft = ev.args.oft;
  },
});

export const BRIDGE_STEPS: BridgeStep[] = [
  {
    id: 'adapter',
    side: 'home',
    title: "Deploy the adapter on your token's chain",
    detail: 'Locks tokens while they are on Base or Ethereum. Rejects tokens with a transfer tax.',
    run: async (c) => {
      c.r.adapter = await c.deploy('home', A.OGTokenAdapter as never, [c.p.token, c.p.home.endpoint, c.p.wallet], 'Deploy adapter');
    },
  },
  {
    id: 'taxCheck',
    side: 'home',
    title: 'Check your token has no transfer tax',
    detail: 'Approves a tiny amount and simulates a round trip, so a taxed token stops here',
    run: async (c) => {
      const decimals = (await c.read('home', c.p.token, erc20Abi as Abi, 'decimals', [])) as number;
      const probe = 10n ** BigInt(decimals - 6);
      await c.write('home', c.p.token, erc20Abi as Abi, 'approve', [c.r.adapter, probe], 'Approve tiny amount');
      await c.simulate('home', c.r.adapter!, A.OGTokenAdapter.abi as Abi, 'checkToken', [probe]);
    },
  },
  deployOft('base'),
  deployOft('eth'),
  peerStep('home', 'base'),
  peerStep('home', 'eth'),
  ...configSteps('home'),
  peerStep('base', 'home'),
  peerStep('base', 'eth'),
  ...configSteps('base'),
  peerStep('eth', 'home'),
  peerStep('eth', 'base'),
  ...configSteps('eth'),
  {
    id: 'verify',
    side: 'base',
    title: 'Check the settings took effect',
    detail: 'Reads every side back. No transaction.',
    run: async (c) => {
      for (const side of sidesOf(c.p)) {
        const here = chainOf(c.p, side);
        for (const r of remotesOf(c.p, side)) {
          const eid = chainOf(c.p, r).eid;
          const peer = (await c.read(side, oappOf(c.r, side), abiOf(side), 'peers', [eid])) as string;
          if (BigInt(peer) !== BigInt(oappOf(c.r, r))) throw new Error(`${here.name}: not linked to ${chainOf(c.p, r).name}`);
          const want = sorted(dvnsOn(c.p, side, r)).map((a) => a.toLowerCase()).join();
          for (const lib of [here.sendLib, here.receiveLib]) {
            const cfg = (await c.read(side, lib, ulnAbi as Abi, 'getUlnConfig', [oappOf(c.r, side), eid])) as { requiredDVNs: readonly Address[] };
            if (cfg.requiredDVNs.map((a) => a.toLowerCase()).join() !== want) throw new Error(`${here.name}: the required verifiers did not apply`);
          }
        }
      }
    },
  },
  ...handOver('home'),
  ...handOver('base'),
  ...handOver('eth'),
];
