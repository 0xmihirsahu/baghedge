"use client";

import { useEffect, useRef, useState } from "react";

// live hyperliquid data for the terminal: one websocket for prices, SOL's market context, SOL trades and the SOL candle,
// plus info snapshots for history (candles, previous-day prices, size precision and max leverage)
const INFO = "https://api.hyperliquid.xyz/info";
const WS = "wss://api.hyperliquid.xyz/ws";

export type Trade = { px: number; sz: number; side: "B" | "A"; time: number; tid: number };
type RawTrade = { px: string; sz: string; side: "B" | "A"; time: number; tid: number };
const toTrade = (r: RawTrade): Trade => ({ px: +r.px, sz: +r.sz, side: r.side, time: r.time, tid: r.tid });
// newest first, each trade once (the snapshot and the socket overlap)
const merge = (add: Trade[], old: Trade[]) => {
  const seen = new Set<number>();
  return [...add, ...old].filter((t) => !seen.has(t.tid) && seen.add(t.tid)).sort((a, b) => b.time - a.time).slice(0, 60);
};
export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type SolCtx = { mark: number; prevDay: number; funding: number; oi: number; maxLeverage: number; szDecimals: number };
export type Interval = "1m" | "15m" | "1h" | "4h";

export async function info<T>(body: unknown): Promise<T> {
  const r = await fetch(INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`hyperliquid ${r.status}`);
  return r.json();
}

type Meta = [{ universe: { name: string; szDecimals: number; maxLeverage: number }[] }, { markPx: string; midPx: string | null; prevDayPx: string; funding: string; openInterest: string }[]];

export function useHyperliquid(interval: Interval, hours: number) {
  const [mids, setMids] = useState<Record<string, number>>({});
  const [prevDay, setPrevDay] = useState<Record<string, number>>({});
  const [sol, setSol] = useState<SolCtx | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [live, setLive] = useState(false);
  const meta = useRef<{ maxLeverage: number; szDecimals: number }>({ maxLeverage: 20, szDecimals: 2 });

  // previous-day prices for every market's 24h change, and SOL's precision and leverage, refreshed each minute
  useEffect(() => {
    const load = () =>
      info<Meta>({ type: "metaAndAssetCtxs" })
        .then(([m, ctxs]) => {
          const prev: Record<string, number> = {}, now: Record<string, number> = {};
          m.universe.forEach((u, i) => {
            prev[u.name] = Number(ctxs[i].prevDayPx);
            now[u.name] = Number(ctxs[i].midPx ?? ctxs[i].markPx);
          });
          setPrevDay(prev);
          // fills the list before the socket's first push; the socket wins after that
          setMids((m) => (Object.keys(m).length ? m : now));
          const i = m.universe.findIndex((u) => u.name === "SOL");
          meta.current = { maxLeverage: m.universe[i].maxLeverage, szDecimals: m.universe[i].szDecimals };
          const x = ctxs[i];
          setSol((s) => s ?? { mark: Number(x.markPx), prevDay: Number(x.prevDayPx), funding: Number(x.funding), oi: Number(x.openInterest), ...meta.current });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // candle history for the chosen range, then the websocket keeps the last candle moving
  useEffect(() => {
    const end = Date.now();
    info<{ t: number; o: string; h: string; l: string; c: string }[]>({ type: "candleSnapshot", req: { coin: "SOL", interval, startTime: end - hours * 3600_000, endTime: end } })
      .then((rows) => setCandles(rows.map((r) => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c }))))
      .catch(() => {});
    info<RawTrade[]>({ type: "recentTrades", coin: "SOL" })
      .then((rows) => setTrades((t) => merge(rows.map(toTrade), t)))
      .catch(() => {});
  }, [interval, hours]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const open = () => {
      ws = new WebSocket(WS);
      ws.onopen = () => {
        setLive(true);
        for (const s of [{ type: "allMids" }, { type: "activeAssetCtx", coin: "SOL" }, { type: "trades", coin: "SOL" }, { type: "candle", coin: "SOL", interval }])
          ws!.send(JSON.stringify({ method: "subscribe", subscription: s }));
        ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ method: "ping" })), 45_000);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.channel === "allMids") {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(m.data.mids as Record<string, string>)) if (!k.startsWith("@")) next[k] = Number(v);
          setMids(next);
        } else if (m.channel === "activeAssetCtx" && m.data.coin === "SOL") {
          const c = m.data.ctx;
          setSol({ mark: Number(c.markPx), prevDay: Number(c.prevDayPx), funding: Number(c.funding), oi: Number(c.openInterest), ...meta.current });
        } else if (m.channel === "trades") {
          setTrades((t) => merge((m.data as RawTrade[]).map(toTrade), t));
        } else if (m.channel === "candle" && m.data.i === interval) {
          const k = m.data;
          const c: Candle = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c };
          setCandles((cs) => (cs.length && cs[cs.length - 1].t === c.t ? [...cs.slice(0, -1), c] : cs.length ? [...cs.slice(1), c] : cs));
        }
      };
      ws.onclose = () => {
        setLive(false);
        clearInterval(ping);
        if (!closed) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(retry);
      ws?.close();
    };
  }, [interval]);

  return { mids, prevDay, sol, trades, candles, live };
}
