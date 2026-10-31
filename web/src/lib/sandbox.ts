import type { NetworkConfig } from '@/config/networks';

/** Calls an anvil-only RPC method on the sandbox chain. */
export async function anvil(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export const sandboxUrls = (net: NetworkConfig) => [net.l1.rpcUrls.default.http[0], net.l2.rpcUrls.default.http[0]];

export const isLocalHost = () =>
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
