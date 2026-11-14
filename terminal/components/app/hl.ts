"use client";

import { useEffect, useState } from "react";

// live hyperliquid mainnet data. public info reads and the public websocket, no keys:
// - useMarkets: every perp's context (snapshot each minute) with mids pushed live
// - useCoin: one coin's candles, trades and context, live
// - useAccount: a hyperliquid account's equity, positions and fills, by its public address
// fallbacks so the screen never stalls: info tries the api host, then the ui host (both public, both tested);
// whenever the socket is down, the hooks poll info instead until it's back
// the network follows the baghedge backend (GET /api/health → mode), set once at start before any hook runs
export type Network = "mainnet" | "testnet";
const HOSTS: Record<Network, { info: string[]; ws: string }> = {
  mainnet: { info: ["https://api.hyperliquid.xyz/info", "https://api-ui.hyperliquid.xyz/info"], ws: "wss://api.hyperliquid.xyz/ws" },
  testnet: { info: ["https://api.hyperliquid-testnet.xyz/info"], ws: "wss://api.hyperliquid-testnet.xyz/ws" },
};
let NET: Network = "mainnet";
export const setNetwork = (n: Network) => {
  NET = n;
  preferred = 0;
};
export const getNetwork = () => NET;

export type Trade = { px: number; sz: number; side: "B" | "A"; time: number; tid: number };
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Market = { name: string; mark: number; prevDay: number; funding: number; oi: number; volume: number; maxLeverage: number; szDecimals: number };
export type Interval = "1m" | "15m" | "1h" | "4h";

type RawTrade = { px: string; sz: string; side: "B" | "A"; time: number; tid: number };
const toTrade = (r: RawTrade): Trade => ({ px: +r.px, sz: +r.sz, side: r.side, time: r.time, tid: r.tid });
// newest first, each trade once (the snapshot and the socket overlap)
const merge = (add: Trade[], old: Trade[]) => {
  const seen = new Set<number>();
  return [...add, ...old].filter((t) => !seen.has(t.tid) && seen.add(t.tid)).sort((a, b) => b.time - a.time).slice(0, 60);
};

// the host that last answered goes first, so one bad host costs a single timeout, not one per call
let preferred = 0;
export async function info<T>(body: unknown): Promise<T> {
  let last: unknown;
  const INFO = HOSTS[NET].info;
  for (let i = 0; i < INFO.length; i++) {
    const at = (preferred + i) % INFO.length;
    try {
      const r = await fetch(INFO[at], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`hyperliquid ${r.status}`);
      const j = await r.json();
      preferred = at;
      return j;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// runs `poll` every `ms` while the socket is down (after a short grace, so a normal connect doesn't trigger it)
function useFallbackPoll(live: boolean, ms: number, poll: () => void, deps: unknown[]) {
  useEffect(() => {
    if (live) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const grace = setTimeout(() => {
      poll();
      t = setInterval(poll, ms);
    }, 4000);
    return () => {
      clearTimeout(grace);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ms, ...deps]);
}

// one socket with reconnects and keepalive; `subs` are sent on every (re)connect
function socket(subs: object[], onMessage: (m: { channel: string; data: never }) => void, onLive: (live: boolean) => void) {
  let ws: WebSocket | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const open = () => {
    ws = new WebSocket(HOSTS[NET].ws);
    ws.onopen = () => {
      onLive(true);
      for (const s of subs) ws!.send(JSON.stringify({ method: "subscribe", subscription: s }));
      ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ method: "ping" })), 45_000);
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onLive(false);
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
}

type Meta = [
  { universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] },
  { markPx: string; midPx: string | null; prevDayPx: string; funding: string; openInterest: string; dayNtlVlm: string }[],
];

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [mids, setMids] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);

  useEffect(() => {
    const load = () =>
      info<Meta>({ type: "metaAndAssetCtxs" })
        .then(([m, ctxs]) => {
          const list = m.universe
            .map((u, i) => ({ u, c: ctxs[i] }))
            .filter(({ u }) => !u.isDelisted)
            .map(({ u, c }) => ({
              name: u.name,
              mark: Number(c.markPx),
              prevDay: Number(c.prevDayPx),
              funding: Number(c.funding),
              oi: Number(c.openInterest) * Number(c.markPx),
              volume: Number(c.dayNtlVlm),
              maxLeverage: u.maxLeverage,
              szDecimals: u.szDecimals,
            }));
          setMarkets(list);
          // fills prices before the socket's first push; the socket wins after that
          setMids((old) => (Object.keys(old).length ? old : Object.fromEntries(list.map((x) => [x.name, x.mark]))));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    const stop = socket(
      [{ type: "allMids" }],
      (m) => {
        if (m.channel !== "allMids") return;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries((m.data as { mids: Record<string, string> }).mids)) if (!k.startsWith("@")) next[k] = Number(v);
        setMids(next);
      },
      setLive,
    );
    return () => {
      clearInterval(t);
      stop();
    };
  }, []);

  useFallbackPoll(live, 3000, () => {
    info<Record<string, string>>({ type: "allMids" })
      .then((all) => setMids(Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith("@")).map(([k, v]) => [k, Number(v)]))))
      .catch(() => {});
  }, []);

  return { markets, mids, live };
}

export function useCoin(coin: string | null, interval: Interval, hours: number) {
  const [ctx, setCtx] = useState<{ mark: number; prevDay: number; funding: number; oi: number } | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [live, setLive] = useState(false);

  // candle history for the chosen range; the socket keeps the last candle moving
  useEffect(() => {
    if (!coin) return;
    const end = Date.now();
    info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - hours * 3600_000, endTime: end } })
      .then((rows) => setCandles(rows.map((r) => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }))))
      .catch(() => {});
  }, [coin, interval, hours]);

  // socket down: poll the tape and the latest candle instead
  const step = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 }[interval];
  useFallbackPoll(live, 4000, () => {
    if (!coin) return;
    info<RawTrade[]>({ type: "recentTrades", coin })
      .then((rows) => setTrades((t) => merge(rows.map(toTrade), t)))
      .catch(() => {});
    const end = Date.now();
    info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - step * 2, endTime: end } })
      .then((rows) => {
        const r = rows.at(-1);
        if (!r) return;
        const c: Candle = { t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v };
        setCandles((cs) => (cs.length && cs[cs.length - 1].t === c.t ? [...cs.slice(0, -1), c] : cs.length ? [...cs.slice(1), c] : cs));
      })
      .catch(() => {});
  }, [coin, interval]);

  useEffect(() => {
    if (!coin) return;
    info<RawTrade[]>({ type: "recentTrades", coin })
      .then((rows) => setTrades((t) => merge(rows.map(toTrade), t)))
      .catch(() => {});
    return socket(
      [{ type: "activeAssetCtx", coin }, { type: "trades", coin }, { type: "candle", coin, interval }],
      (m) => {
        const d = m.data as Record<string, unknown>;
        if (m.channel === "activeAssetCtx" && d.coin === coin) {
          const c = d.ctx as Record<string, string>;
          setCtx({ mark: Number(c.markPx), prevDay: Number(c.prevDayPx), funding: Number(c.funding), oi: Number(c.openInterest) * Number(c.markPx) });
        } else if (m.channel === "trades") {
          setTrades((t) => merge((m.data as RawTrade[]).filter((r) => (r as unknown as { coin: string }).coin === coin).map(toTrade), t));
        } else if (m.channel === "candle" && d.i === interval && d.s === coin) {
          const c: Candle = { t: d.t as number, o: +(d.o as string), h: +(d.h as string), l: +(d.l as string), c: +(d.c as string), v: +(d.v as string) };
          setCandles((cs) => (cs.length && cs[cs.length - 1].t === c.t ? [...cs.slice(0, -1), c] : cs.length ? [...cs.slice(1), c] : cs));
        }
      },
      setLive,
    );
  }, [coin, interval]);

  return { ctx, trades, candles };
}

export type Position = { coin: string; size: number; entry: number; value: number; pnl: number; leverage: number; liq: number | null };
export type Fill = { coin: string; px: number; sz: number; side: "B" | "A"; time: number; dir: string; pnl: number; fee: number; tid: number };
export type Account = { equity: number; withdrawable: number; positions: Position[]; fills: Fill[] };

// a hyperliquid master account's public state, refreshed every 15 s. query with the master address, never an agent's (rule 7)
export function useAccount(address: string | null) {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!address) return;
    let gone = false;
    const load = () =>
      Promise.all([
        info<{ marginSummary: { accountValue: string }; withdrawable: string; assetPositions: { position: Record<string, unknown> }[] }>({ type: "clearinghouseState", user: address }),
        info<Record<string, unknown>[]>({ type: "userFills", user: address }),
      ])
        .then(([s, f]) => {
          if (gone) return;
          setError(false);
          setAccount({
            equity: Number(s.marginSummary.accountValue),
            withdrawable: Number(s.withdrawable),
            positions: s.assetPositions.map(({ position: p }) => ({
              coin: p.coin as string,
              size: Number(p.szi),
              entry: Number(p.entryPx),
              value: Number(p.positionValue),
              pnl: Number(p.unrealizedPnl),
              leverage: Number((p.leverage as { value: number }).value),
              liq: p.liquidationPx ? Number(p.liquidationPx) : null,
            })),
            fills: f.slice(0, 50).map((x) => ({
              coin: x.coin as string,
              px: Number(x.px),
              sz: Number(x.sz),
              side: x.side as "B" | "A",
              time: x.time as number,
              dir: x.dir as string,
              pnl: Number(x.closedPnl),
              fee: Number(x.fee),
              tid: x.tid as number,
            })),
          });
        })
        .catch(() => !gone && setError(true));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [address]);
  return { account: address ? account : null, error };
}
