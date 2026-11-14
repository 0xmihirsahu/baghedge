"use client";

import { useEffect, useState } from "react";

// solana address helpers and the watched wallet's balance. we only ever read the public balance,
// through /api/balance so the rpc key stays on the server
export const isSolAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());
export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// liquid SOL from solana mainnet. the last balance shows at once from this browser, then a read every 30 s
// while the tab is visible, and one on return. native stake reads are planned in the brief, not here yet
export function useSolBalance(address: string | null, onError: (message: string) => void) {
  const [sol, setSol] = useState<{ address: string; value: number } | null>(null);
  useEffect(() => {
    if (!address) return;
    let gone = false;
    let failed = false;
    try {
      const last = localStorage.getItem(`bh:sol:${address}`);
      if (last !== null) setTimeout(() => !gone && setSol({ address, value: Number(last) }), 0);
    } catch {}
    const read = () => {
      if (document.hidden) return;
      fetch(`/api/balance?address=${address}`)
        .then((r) => r.json())
        .then((j) => {
          if (gone) return;
          if (typeof j.sol !== "number") throw new Error();
          failed = false;
          setSol({ address, value: j.sol });
          try {
            localStorage.setItem(`bh:sol:${address}`, String(j.sol));
          } catch {}
        })
        .catch(() => {
          // say it once, not every 30 s
          if (!gone && !failed) onError("Couldn't read the balance");
          failed = true;
        });
    };
    read();
    const t = setInterval(read, 30_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      gone = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", read);
    };
  }, [address, onError]);
  return address && sol?.address === address ? sol.value : null;
}
