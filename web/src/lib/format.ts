export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
