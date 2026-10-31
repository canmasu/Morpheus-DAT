import type { Chain, Hash } from 'viem';

export type TxNotice = {
  id: number;
  hash: Hash;
  chain: Chain;
  label: string;
  status: 'pending' | 'success' | 'failed';
  at: number;
};

type Listener = (list: TxNotice[]) => void;

let notices: TxNotice[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(notices));

/** Records a sent transaction; returns a function to set its final status. */
export function trackTx(hash: Hash, chain: Chain, label: string) {
  const id = nextId++;
  notices = [{ id, hash, chain, label, status: 'pending' as const, at: Date.now() }, ...notices].slice(0, 6);
  emit();
  return (status: 'success' | 'failed') => {
    notices = notices.map((n) => (n.id === id ? { ...n, status, at: Date.now() } : n));
    emit();
  };
}

export function dismissTx(id: number) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function subscribeTx(l: Listener) {
  listeners.add(l);
  l(notices);
  return () => {
    listeners.delete(l);
  };
}
