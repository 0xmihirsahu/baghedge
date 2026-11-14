"use client";

import { useCallback, useEffect, useState } from "react";

// the watched wallet: connect any solana wallet, or watch an address. we only ever read its public balance,
// through /api/balance so a paid key stays on the server

type Provider = { connect: () => Promise<{ publicKey: { toString(): string } } | void>; disconnect: () => Promise<void>; publicKey?: { toString(): string } | null };

// the injected solana wallet, whichever the browser has
export function provider(): Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: Provider }; solflare?: Provider; backpack?: { solana?: Provider }; solana?: Provider };
  return w.phantom?.solana ?? w.solflare ?? w.backpack?.solana ?? w.solana ?? null;
}

export const isSolAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function useWatchedWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [source, setSource] = useState<"wallet" | "watch" | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) {
      setError("No Solana wallet in this browser. Watch an address instead.");
      return;
    }
    try {
      const r = await p.connect();
      const key = (r && r.publicKey) ?? p.publicKey;
      if (!key) throw new Error("no key");
      setAddress(key.toString());
      setSource("wallet");
      setError(null);
    } catch {
      setError("The wallet didn't connect.");
    }
  }, []);

  const watch = useCallback((a: string) => {
    if (!isSolAddress(a)) return setError("That isn't a Solana address.");
    setAddress(a.trim());
    setSource("watch");
    setError(null);
  }, []);

  const forget = useCallback(() => {
    if (source === "wallet") provider()?.disconnect().catch(() => {});
    setAddress(null);
    setSource(null);
    setSol(null);
  }, [source]);

  // liquid SOL from solana mainnet. the last balance shows at once from this browser, then a read every 30 s
  // while the tab is visible, and one on return. native stake reads are planned in the brief, not here yet
  useEffect(() => {
    if (!address) return;
    let gone = false;
    try {
      const last = localStorage.getItem(`bh:sol:${address}`);
      if (last !== null) setTimeout(() => !gone && setSol(Number(last)), 0);
    } catch {}
    const read = () => {
      if (document.hidden) return;
      fetch(`/api/balance?address=${address}`)
        .then((r) => r.json())
        .then((j) => {
          if (gone || typeof j.sol !== "number") return;
          setSol(j.sol);
          try { localStorage.setItem(`bh:sol:${address}`, String(j.sol)); } catch {}
        })
        .catch(() => !gone && setError("Couldn't read the balance."));
    };
    read();
    const t = setInterval(read, 30_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      gone = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", read);
    };
  }, [address]);

  return { address, source, sol, error, connect, watch, forget };
}
