'use client';

import { useEffect, useState } from 'react';
import type { NetworkConfig } from '@/config/networks';
import { publicClient } from '@/lib/tx';

/** Current time on the network's Ethereum chain, in seconds, ticking every second. Follows the chain clock
 * rather than the computer's, so countdowns stay right after the sandbox skips time ahead. */
export function useChainNow(net: NetworkConfig) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    let alive = true;
    const sync = () =>
      publicClient(net.l1)
        .getBlock()
        .then((b) => alive && setOffset(Number(b.timestamp) - Math.floor(Date.now() / 1000)))
        .catch(() => {});
    sync();
    const s = setInterval(sync, 15_000);
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      alive = false;
      clearInterval(s);
      clearInterval(t);
    };
  }, [net]);
  // Never earlier than wall time: anvil only moves forward.
  return now + Math.max(0, offset);
}
