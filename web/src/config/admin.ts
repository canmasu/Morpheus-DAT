import type { Address } from 'viem';

/**
 * Wallets that can open the admin pages. This only gates the UI: what a wallet can actually change
 * is decided on-chain by the roles it holds (DEFAULT_ADMIN_ROLE, GUARDIAN_ROLE, ...).
 */
export const ADMIN_WALLETS: Address[] = [
  '0x1ADe0588fC195d7809Ef334919023e3C2E6570C5',
];

export function isAdmin(address?: string) {
  if (!address) return false;
  return ADMIN_WALLETS.some((w) => w.toLowerCase() === address.toLowerCase());
}
