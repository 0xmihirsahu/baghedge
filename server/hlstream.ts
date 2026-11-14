import { isDecimal, isRecord } from "./http";

/**
 * Live mark price and top of book from Hyperliquid's websocket (`activeAssetCtx` + `bbo`).
 * Subscriptions don't count against the /info weight budget, so the worker's mark crossing detection doesn't
 * depend on HTTP rate limits.
 *
 * Measured on mainnet (SOL, 25 s): `activeAssetCtx` about every 1 s, `bbo` about every 0.1 s, while `l2Book`
 * and `allMids` went 12 s between messages. `quote()` returns data only while both the mark and the book
 * arrived within `maxAgeMs`, and reports each one's receive time. Otherwise it returns null, and callers fall
 * back to HTTP, so a silent or dropped socket never feeds a stale mark.
 */
/** `markAt` and `bookAt` are receive times. The worker uses markAt as the mark's sequence, so they stay separate. */
export type StreamQuote = { markPx: string; bestBid: string | null; bestAsk: string | null; markAt: number; bookAt: number };
export type MarketStream = { quote(coin: string, maxAgeMs: number): StreamQuote | null; stop(): void };

type Socket = Pick<WebSocket, "send" | "close"> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export function createMarketStream(
  wsUrl: string,
  coins: string[],
  opts: { connect?: (url: string) => Socket; now?: () => number; log?: (line: string) => void } = {},
): MarketStream {
  const now = opts.now ?? (() => Date.now());
  const connect = opts.connect ?? (url => new WebSocket(url) as unknown as Socket);
  const log = opts.log ?? (line => console.log(line));
  const marks = new Map<string, { px: string; at: number }>();
  const books = new Map<string, { bid: string | null; ask: string | null; at: number }>();
  let socket: Socket | null = null;
  let stopped = false;
  let backoffMs = 1_000;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const side = (level: unknown) => isRecord(level) && isDecimal(level.px) ? level.px : null;

  function handle(raw: unknown) {
    let msg: unknown;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!isRecord(msg) || !isRecord(msg.data)) return;
    const data = msg.data;
    if (typeof data.coin !== "string" || !coins.includes(data.coin)) return;
    if (msg.channel === "activeAssetCtx" && isRecord(data.ctx) && isDecimal(data.ctx.markPx)) {
      marks.set(data.coin, { px: data.ctx.markPx, at: now() });
    } else if (msg.channel === "bbo" && Array.isArray(data.bbo)) {
      books.set(data.coin, { bid: side(data.bbo[0]), ask: side(data.bbo[1]), at: now() });
    }
  }

  function open() {
    if (stopped) return;
    const ws = connect(wsUrl);
    socket = ws;
    ws.onopen = () => {
      backoffMs = 1_000;
      for (const coin of coins) {
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin } }));
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "bbo", coin } }));
      }
      clearInterval(ping);
      // The venue closes sockets idle for 60 s.
      ping = setInterval(() => { try { ws.send(JSON.stringify({ method: "ping" })); } catch { /* reconnect handles it */ } }, 30_000);
    };
    ws.onmessage = ev => handle(ev.data);
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      clearInterval(ping);
      // Drop what we had: after a disconnect, quotes come from HTTP until the feed is back.
      marks.clear(); books.clear();
      if (socket === ws) socket = null;
      if (stopped) return;
      log(`market stream closed; reconnecting in ${backoffMs / 1000}s`);
      retry = setTimeout(open, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    };
  }

  open();

  return {
    quote(coin, maxAgeMs) {
      const mark = marks.get(coin);
      const book = books.get(coin);
      const t = now();
      if (!mark || !book || t - mark.at > maxAgeMs || t - book.at > maxAgeMs) return null;
      return { markPx: mark.px, bestBid: book.bid, bestAsk: book.ask, markAt: mark.at, bookAt: book.at };
    },
    stop() {
      stopped = true;
      clearInterval(ping); clearTimeout(retry);
      socket?.close();
    },
  };
}
