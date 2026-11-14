import { describe, expect, test } from "bun:test";
import { createExchange } from "../server/exchange";
import { createInfoClient } from "../server/hlinfo";
import { createMarketStream } from "../server/hlstream";

function fakeVenue(handler: (payload: Record<string, unknown>) => unknown = () => ({ ok: true })) {
  const calls: Record<string, unknown>[] = [];
  const request = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    calls.push(payload);
    await Bun.sleep(1);
    const body = handler(payload);
    if (body instanceof Response) return body;
    return Response.json(body);
  }) as unknown as typeof fetch;
  return { calls, request };
}

describe("createInfoClient", () => {
  test("caches within maxAge, shares in-flight reads, and always refetches with maxAge 0", async () => {
    const { calls, request } = fakeVenue();
    let t = 1_000;
    const client = createInfoClient("https://hl.invalid", request, () => t);
    const meta = { type: "metaAndAssetCtxs" };
    const [a, b] = await Promise.all([client.read(meta, 1_000), client.read(meta, 1_000)]);
    expect(calls).toHaveLength(1);                 // coalesced
    expect(a).toBe(b);
    expect(a.fetchedAt).toBe(1_000);
    t = 1_900;
    await client.read(meta, 1_000);
    expect(calls).toHaveLength(1);                 // cached
    t = 2_100;
    expect((await client.read(meta, 1_000)).fetchedAt).toBe(2_100);
    expect(calls).toHaveLength(2);                 // expired
    const position = { type: "clearinghouseState", user: "0xabc" };
    await Promise.all([client.read(position), client.read(position)]);
    expect(calls).toHaveLength(4);                 // worker reads: never shared or cached
  });

  test("keeps the 429 in the error message so the worker backs off, and doesn't cache failures", async () => {
    let limited = true;
    const { calls, request } = fakeVenue(() => limited ? new Response("rate limited", { status: 429 }) : { ok: 1 });
    const client = createInfoClient("https://hl.invalid", request);
    await expect(client.read({ type: "l2Book", coin: "SOL" }, 1_000)).rejects.toThrow("HTTP 429");
    limited = false;
    expect((await client.read({ type: "l2Book", coin: "SOL" }, 1_000)).data).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });
});

type FakeSocket = {
  sent: string[]; send(s: string): void; close(): void;
  onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null;
};

function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const connect = () => {
    const s: FakeSocket = { sent: [], send(x) { this.sent.push(x); }, close() { this.onclose?.({}); },
      onopen: null, onmessage: null, onclose: null, onerror: null };
    sockets.push(s);
    return s;
  };
  return { sockets, connect };
}

const ctxMsg = (coin: string, markPx: string) => ({ data: JSON.stringify({ channel: "activeAssetCtx", data: { coin, ctx: { markPx } } }) });
const bookMsg = (coin: string, bid: string, ask: string) => ({ data: JSON.stringify({ channel: "bbo",
  data: { coin, time: 1, bbo: [{ px: bid, sz: "1", n: 1 }, { px: ask, sz: "1", n: 1 }] } }) });

describe("createMarketStream", () => {
  test("subscribes, quotes only while both feeds are fresh, and drops quotes on disconnect", () => {
    const { sockets, connect } = fakeSockets();
    let t = 10_000;
    const stream = createMarketStream("wss://hl.invalid/ws", ["SOL"], { connect, now: () => t, log: () => {} });
    const ws = sockets[0]!;
    ws.onopen?.({});
    expect(ws.sent.map(m => JSON.parse(m).subscription?.type)).toEqual(["activeAssetCtx", "bbo"]);
    ws.onmessage?.(ctxMsg("SOL", "70.45"));
    expect(stream.quote("SOL", 3_000)).toBeNull();          // no book yet
    t = 10_500;
    ws.onmessage?.(bookMsg("SOL", "70.44", "70.46"));
    ws.onmessage?.(ctxMsg("BTC", "1"));                      // other coins ignored
    expect(stream.quote("SOL", 3_000)).toEqual({ markPx: "70.45", bestBid: "70.44", bestAsk: "70.46", markAt: 10_000, bookAt: 10_500 });
    t = 13_100;
    ws.onmessage?.(bookMsg("SOL", "70.43", "70.45"));
    expect(stream.quote("SOL", 3_000)).toBeNull();          // book live but mark older than 3 s
    ws.onmessage?.(ctxMsg("SOL", "70.40"));
    expect(stream.quote("SOL", 3_000)).toEqual({ markPx: "70.40", bestBid: "70.43", bestAsk: "70.45", markAt: 13_100, bookAt: 13_100 });
    t = 16_200;
    expect(stream.quote("SOL", 3_000)).toBeNull();          // both silent
    expect(stream.status()).toEqual({ connected: true, reconnects: 0, coins: { SOL: { markAgeMs: 3_100, bookAgeMs: 3_100 } } });
    ws.onclose?.({});
    expect(stream.quote("SOL", 3_000)).toBeNull();          // disconnected: callers fall back to HTTP
    expect(stream.status()).toEqual({ connected: false, reconnects: 1, coins: { SOL: { markAgeMs: null, bookAgeMs: null } } });
    stream.stop();
  });
});

describe("exchange.market", () => {
  const meta = [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "SOL", szDecimals: 2, maxLeverage: 20 }] },
    [{ markPx: "1" }, { markPx: "71.00" }]];
  const book = { coin: "SOL", levels: [[{ px: "70.99", sz: "1", n: 1 }], [{ px: "71.01", sz: "1", n: 1 }]] };
  const handler = (p: Record<string, unknown>) => p.type === "metaAndAssetCtxs" ? meta : p.type === "l2Book" ? book : null;

  test("uses the live stream when fresh (no book request) and HTTP with the fetch time otherwise", async () => {
    const { calls, request } = fakeVenue(handler);
    let t = 50_000;
    const infoClient = createInfoClient("https://hl.invalid", request, () => t);
    let live: ReturnType<ReturnType<typeof createMarketStream>["quote"]> = { markPx: "70.45", bestBid: "70.44", bestAsk: "70.46", markAt: 49_900, bookAt: 49_950 };
    const stream = { quote: () => live, status: () => ({ connected: true, reconnects: 0, coins: {} }), stop() {} };
    const exchange = createExchange("mainnet", request, { infoClient, stream });

    expect(await exchange.market("SOL")).toEqual({ asset: 1, sizeDecimals: 2, maxLeverage: 20,
      markPx: "70.45", bestBid: "70.44", bestAsk: "70.46", markObservedAt: 49_900, bookObservedAt: 49_950, observedAt: 49_900 });
    t = 54_000;
    await exchange.market("SOL");
    expect(calls.map(c => c.type)).toEqual(["metaAndAssetCtxs"]);   // meta cached for a minute, mark from the stream

    live = null;
    t = 60_000;
    expect(await exchange.market("SOL")).toMatchObject({ markPx: "71.00", bestBid: "70.99", bestAsk: "71.01", markObservedAt: 60_000, bookObservedAt: 60_000 });
    // The meta read was 6 s old (> 1 s), so it was refetched for a fresh mark alongside the book.
    expect(calls.map(c => c.type)).toEqual(["metaAndAssetCtxs", "metaAndAssetCtxs", "l2Book"]);
  });
});

describe("stream mark crossing (Codex review of #15)", () => {
  test("a new mark with an unchanged book is a new observation, so the engine can see the crossing", async () => {
    const { request } = fakeVenue(p => p.type === "metaAndAssetCtxs"
      ? [{ universe: [{ name: "SOL", szDecimals: 2, maxLeverage: 20 }] }, [{ markPx: "70.50" }]] : null);
    const { sockets, connect } = fakeSockets();
    let t = 10_000;
    const stream = createMarketStream("wss://hl.invalid/ws", ["SOL"], { connect, now: () => t, log: () => {} });
    const exchange = createExchange("mainnet", request, { infoClient: createInfoClient("https://hl.invalid", request, () => t), stream });
    const ws = sockets[0]!;
    ws.onopen?.({});
    ws.onmessage?.(bookMsg("SOL", "70.49", "70.51"));       // book at 10 000, then silent
    ws.onmessage?.(ctxMsg("SOL", "70.50"));
    const above = await exchange.market("SOL");
    t = 11_000;
    ws.onmessage?.(ctxMsg("SOL", "70.40"));                 // mark crosses below; no new book message
    const below = await exchange.market("SOL");
    expect([above.markPx, below.markPx]).toEqual(["70.50", "70.40"]);
    expect(below.markObservedAt).toBeGreaterThan(above.markObservedAt);   // distinct sequence → crossing visible
    expect(below.bookObservedAt).toBe(above.bookObservedAt);
    stream.stop();
  });
});
