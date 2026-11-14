"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// hyperliquid's info api allows any origin, so the browser reads it directly
const INFO = "https://api.hyperliquid.xyz/info";

export const LAUNCH = ["BTC", "ETH", "SOL", "HYPE", "NEAR"] as const;
export const TAPE = ["BTC", "ETH", "SOL", "HYPE", "NEAR", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB"] as const;
export type Coin = (typeof TAPE)[number];

export const NAMES: Record<Coin, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  HYPE: "Hyperliquid",
  NEAR: "NEAR",
  XRP: "XRP",
  DOGE: "Dogecoin",
  SUI: "Sui",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  BNB: "BNB",
};

export const LOGO: Record<Coin, string> = {
  BTC: "/tokens/BTC.png",
  ETH: "/tokens/ETH.png",
  SOL: "/tokens/SOL.png",
  HYPE: "/tokens/HYPE.jpg",
  NEAR: "/tokens/NEAR.jpg",
  XRP: "/tokens/XRP.png",
  DOGE: "/tokens/DOGE.png",
  SUI: "/tokens/SUI.png",
  AVAX: "/tokens/AVAX.png",
  LINK: "/tokens/LINK.png",
  BNB: "/tokens/BNB.png",
};

export type Market = {
  coin: Coin;
  mark: number;
  prevDay: number;
  change: number;
  funding: number;
  openInterestUsd: number;
  volumeUsd: number;
  maxLeverage: number;
  maintenance: number;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number };

type Universe = { name: string; maxLeverage: number; isDelisted?: boolean }[];
type Ctx = { markPx: string; prevDayPx: string; funding: string; openInterest: string; dayNtlVlm: string };

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hyperliquid answered ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchMarkets(): Promise<Partial<Record<Coin, Market>>> {
  const [meta, ctxs] = await post<[{ universe: Universe }, Ctx[]]>({ type: "metaAndAssetCtxs" });
  const out: Partial<Record<Coin, Market>> = {};
  meta.universe.forEach((asset, i) => {
    if (!(TAPE as readonly string[]).includes(asset.name)) return;
    const c = ctxs[i];
    const mark = Number(c.markPx);
    const prevDay = Number(c.prevDayPx);
    out[asset.name as Coin] = {
      coin: asset.name as Coin,
      mark,
      prevDay,
      change: prevDay ? mark / prevDay - 1 : 0,
      funding: Number(c.funding),
      openInterestUsd: Number(c.openInterest) * mark,
      volumeUsd: Number(c.dayNtlVlm),
      maxLeverage: asset.maxLeverage,
      // hyperliquid's maintenance margin is half the starting margin at max leverage
      maintenance: 1 / (2 * asset.maxLeverage),
    };
  });
  return out;
}

export async function fetchCandles(coin: Coin, interval = "1h", hours = 24 * 9): Promise<Candle[]> {
  const endTime = Date.now();
  const rows = await post<{ t: number; o: string; h: string; l: string; c: string }[]>({
    type: "candleSnapshot",
    req: { coin, interval, startTime: endTime - hours * 3600_000, endTime },
  });
  return rows.map((r) => ({
    time: Math.floor(r.t / 1000),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
  }));
}

type State = { markets: Partial<Record<Coin, Market>>; updated: number | null; error: boolean };

const MarketsContext = createContext<State>({ markets: {}, updated: null, error: false });

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ markets: {}, updated: null, error: false });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchMarkets()
        .then((markets) => alive && setState({ markets, updated: Date.now(), error: false }))
        .catch(() => alive && setState((s) => ({ ...s, error: true })));
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return <MarketsContext.Provider value={state}>{children}</MarketsContext.Provider>;
}

export const useMarkets = () => useContext(MarketsContext);

export function fmtPrice(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const digits = n >= 1000 ? 0 : n >= 10 ? 2 : n >= 1 ? 3 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtUsdCompact(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

export function fmtPct(n: number | undefined, digits = 2) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const v = n * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}
