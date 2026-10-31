import type { Address } from 'viem';
import type { NetworkName } from '@/config/networks';
import testnet from '@/deployments/testnet.json';
import mainnet from '@/deployments/mainnet.json';

export type Deployments = {
  ethereum?: { poolFactory?: Address; otcMarket?: Address; adapter?: Address };
  arbitrum?: { splitterDeployer?: Address; arbFeeConfig?: Address };
};

const ALL: Record<NetworkName, Deployments> = { testnet: testnet as Deployments, mainnet: mainnet as Deployments };

/** Committed address list for a network (web/src/deployments/<network>.json). */
export const deploymentsOf = (n: NetworkName): Deployments => ALL[n];
