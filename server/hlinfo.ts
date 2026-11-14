import { RequestError } from "./http";

/**
 * One Hyperliquid /info client per process, shared by the API routes and the hedge worker.
 *
 * Hyperliquid rate-limits /info by IP (a weight budget per minute). The worker and every frontend poll share
 * this server's IP, so uncached reads let UI traffic starve the worker. A rate-limited worker misses mark
 * crossings, because entry needs two fresh marks at most a few seconds apart.
 *
 * - `maxAgeMs > 0`: return a cached response fetched at most that long ago. Concurrent identical reads share one request.
 * - `maxAgeMs = 0` (default): always a new request. Used for the worker's account reads (positions, order status,
 *   fills): reconciliation must never see a response that started before the order it's checking.
 *
 * Every result carries `fetchedAt`, so callers report when the data was observed, not when it was returned.
 */
export type InfoResult = { data: unknown; fetchedAt: number };
export type InfoClient = {
  read(payload: object, maxAgeMs?: number): Promise<InfoResult>;
};

const MAX_ENTRIES = 2_000;

export function createInfoClient(baseUrl: string, request: typeof fetch = fetch, now = () => Date.now()): InfoClient {
  const cache = new Map<string, InfoResult>();
  const inflight = new Map<string, Promise<InfoResult>>();

  async function fetchInfo(body: string): Promise<InfoResult> {
    const fetchedAt = now();
    let response: Response;
    try {
      response = await request(new URL("/info", baseUrl), {
        method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RequestError(502, "provider_unavailable", "Hyperliquid could not return a response");
    }
    if (!response.ok) {
      await response.body?.cancel();
      // The worker matches "429" in this message to back off.
      throw new RequestError(response.status === 429 ? 503 : 502, "provider_error", `Hyperliquid info returned HTTP ${response.status}`);
    }
    try {
      return { data: await response.json(), fetchedAt };
    } catch {
      throw new RequestError(502, "provider_unavailable", "Hyperliquid returned an unreadable response");
    }
  }

  return {
    async read(payload, maxAgeMs = 0) {
      const body = JSON.stringify(payload);
      if (maxAgeMs <= 0) return fetchInfo(body);
      const hit = cache.get(body);
      if (hit && now() - hit.fetchedAt <= maxAgeMs) return hit;
      const pending = inflight.get(body);
      if (pending) return pending;
      const promise = fetchInfo(body).then(result => {
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(body, result);
        return result;
      }).finally(() => inflight.delete(body));
      inflight.set(body, promise);
      return promise;
    },
  };
}
