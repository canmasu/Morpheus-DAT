import { type Address, getAddress } from 'viem';
import { arbitrum, arbitrumSepolia, mainnet, sepolia, type Chain } from 'viem/chains';

export type NetworkName = 'testnet' | 'mainnet';

export type StakeAsset = {
  symbol: string;
  token: Address;
  decimals: number;
  depositPool: Address;
  poolIndex: number;
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
        symbol: 'stETHMock',
        token: a('0xa878Ad6FF38d6fAE81FBb048384cE91979d448DA'),
        decimals: 18,
        depositPool: a('0xFea33A23F97d785236F22693eDca564782ae98d0'),
        poolIndex: 0,
      },
      {
        symbol: 'LINK',
        token: a('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
        decimals: 18,
        depositPool: a('0x7f4f17be21219D7DA4C8E0d0B9be6a778354E5A5'),
        poolIndex: 0,
      },
    ],
    mor: a('0x34a285A1B1C166420Df5b6630132542923B5b27E'),
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

export const DEFAULT_NETWORK: NetworkName =
  process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export function explorerAddress(chain: Chain, address: string) {
  return `${chain.blockExplorers?.default.url}/address/${address}`;
}

export function explorerTx(chain: Chain, hash: string) {
  return `${chain.blockExplorers?.default.url}/tx/${hash}`;
}
