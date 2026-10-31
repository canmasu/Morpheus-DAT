import type { Address } from 'viem';
import { NETWORKS, type NetworkName } from '@/config/networks';
import testnet from '@/deployments/testnet.json';
import mainnet from '@/deployments/mainnet.json';
import { load } from './storage';
import { toDeploymentsJson, type DeployState } from './deployPlan';

export type Deployments = {
  ethereum?: { poolFactory?: Address; otcMarket?: Address; adapter?: Address };
  arbitrum?: { splitterDeployer?: Address; arbFeeConfig?: Address };
};

const COMMITTED: Record<Exclude<NetworkName, 'local'>, Deployments> = {
  testnet: testnet as Deployments,
  mainnet: mainnet as Deployments,
};

/** Committed address list (web/src/deployments/<network>.json). The sandbox is reset on every start, so its
 * addresses come from this browser's /admin/deploy progress instead. */
export function deploymentsOf(n: NetworkName): Deployments {
  if (n !== 'local') return COMMITTED[n];
  if (typeof window === 'undefined') return {};
  const s = load<DeployState>('dat-deploy-local');
  return s ? (toDeploymentsJson(s, NETWORKS.local) as Deployments) : {};
}
