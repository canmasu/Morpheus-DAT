import { type Address, getAddress } from 'viem';
import { defineChain } from 'viem';
import { arbitrum, arbitrumSepolia, mainnet, sepolia, type Chain } from 'viem/chains';

export type NetworkName = 'testnet' | 'local' | 'mainnet';

export type StakeAsset = {
  symbol: string;
  token: Address;
  decimals: number;
  depositPool: Address;
  poolIndex: number;
  /** Testnet faucet: 'open' = anyone can call mint(to, amount); otherwise an Aave faucet's address. */
  faucet?: 'open' | Address;
};

export type NetworkConfig = {
  name: NetworkName;
  label: string;
  l1: Chain;
  l2: Chain;
  morpheus: {
    distributor: Address;
    l1Sender: Address;
    owner?: Address;
  };
  /** Stake assets with a live Morpheus DepositPool on this network. */
  stakeAssets: StakeAsset[];
  /** MOR on the reward (Arbitrum) chain. */
  mor: Address;
};

const a = (s: string) => getAddress(s.toLowerCase());

/** Local sandbox: anvil fork of Ethereum mainnet (real Morpheus) + a plain anvil standing in for Arbitrum.
 * Started by `npm run sandbox`. */
export const localEthereum = defineChain({
  id: 31337,
  name: 'Sandbox Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});
export const localArbitrum = defineChain({
  id: 31338,
  name: 'Sandbox Arbitrum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8546'] } },
});
/** First contract the sandbox script deploys on the local Arbitrum (deployer nonce 0): a stand-in MOR. */
export const SANDBOX_MOR = a('0x5FbDB2315678afecb367f032d93F642f64180aa3');

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    label: 'Testnet (Sepolia + Arbitrum Sepolia)',
    l1: sepolia,
    l2: arbitrumSepolia,
    morpheus: {
      distributor: a('0x65b8676392432B1cBac1BE4792a5867A8CA2f375'),
      l1Sender: a('0x85e398705d7D77F1703b61DD422869A67B3B409d'),
    },
    stakeAssets: [
      {
        symbol: 'LINK',
        token: a('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
        decimals: 18,
        depositPool: a('0x7f4f17be21219D7DA4C8E0d0B9be6a778354E5A5'),
        poolIndex: 0,
        // Aave V3 Sepolia's LINK; Morpheus supplies it to Aave (the same path as USDC/USDT on mainnet).
        faucet: a('0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'),
      },
      {
        symbol: 'stETHMock',
        token: a('0xa878Ad6FF38d6fAE81FBb048384cE91979d448DA'),
        decimals: 18,
        depositPool: a('0xFea33A23F97d785236F22693eDca564782ae98d0'),
        poolIndex: 0,
        faucet: 'open',
      },
    ],
    mor: a('0x34a285A1B1C166420Df5b6630132542923B5b27E'),
  },
  local: {
    name: 'local',
    label: 'Local sandbox (mainnet fork)',
    l1: localEthereum,
    l2: localArbitrum,
    morpheus: {
      distributor: a('0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A'),
      l1Sender: a('0x2Efd4430489e1a05A89c2f51811aC661B7E5FF84'),
      owner: a('0x1FE04BC15Cf2c5A2d41a0b3a96725596676eBa1E'),
    },
    stakeAssets: [] as StakeAsset[], // filled below: same assets as mainnet
    mor: SANDBOX_MOR,
  },
  mainnet: {
    name: 'mainnet',
    label: 'Mainnet (Ethereum + Arbitrum One)',
    l1: mainnet,
    l2: arbitrum,
    morpheus: {
      distributor: a('0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A'),
      l1Sender: a('0x2Efd4430489e1a05A89c2f51811aC661B7E5FF84'),
      owner: a('0x1FE04BC15Cf2c5A2d41a0b3a96725596676eBa1E'),
    },
    stakeAssets: [
      {
        symbol: 'USDC',
        token: a('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        decimals: 6,
        depositPool: a('0x6cCE082851Add4c535352f596662521B4De4750E'),
        poolIndex: 0,
      },
      {
        symbol: 'USDT',
        token: a('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
        decimals: 6,
        depositPool: a('0x3B51989212BEdaB926794D6bf8e9E991218cf116'),
        poolIndex: 0,
      },
      {
        symbol: 'stETH',
        token: a('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'),
        decimals: 18,
        depositPool: a('0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790'),
        poolIndex: 0,
      },
    ],
    mor: a('0x092bAaDB7DEf4C3981454dD9c0A0D7FF07bCFc86'),
  },
};

NETWORKS.local.stakeAssets = NETWORKS.mainnet.stakeAssets;

export const DEFAULT_NETWORK: NetworkName =
  process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

/** Explorer link, or '#' on the sandbox (no explorer). */
export function explorerAddress(chain: Chain, address: string) {
  return chain.blockExplorers ? `${chain.blockExplorers.default.url}/address/${address}` : '#';
}

export function explorerTx(chain: Chain, hash: string) {
  return chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : '#';
}
