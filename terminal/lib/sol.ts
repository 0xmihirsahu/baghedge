import "server-only";

// SOL balance for a watched address, read on the server so the alchemy key never reaches the browser.
// alchemy first, the free publicnode rpc if it fails. alchemy sits out 10 min after a failure (limit hit, outage).
// one read per address per 30 s no matter how many tabs ask, and concurrent asks share one request
const TTL = 30_000;
const COOLDOWN = 10 * 60_000;
const ALCHEMY = process.env.ALCHEMY_API_KEY ? `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : null;
const FREE = "https://solana-rpc.publicnode.com";

let benchedUntil = 0;
const cache = new Map<string, { at: number; sol: number; via: string }>();
const inflight = new Map<string, Promise<{ at: number; sol: number; via: string } | null>>();

async function getBalance(address: string, url: string) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
    signal: AbortSignal.timeout(3000),
  });
  const j = await r.json().catch(() => null);
  if (typeof j?.result?.value !== "number") throw new Error(j?.error?.message ?? `http ${r.status}`);
  return j.result.value / 1e9;
}

async function read(address: string) {
  const order: [string, string][] = ALCHEMY && Date.now() > benchedUntil ? [["alchemy", ALCHEMY], ["publicnode", FREE]] : [["publicnode", FREE]];
  for (const [via, url] of order) {
    try {
      const out = { at: Date.now(), sol: await getBalance(address, url), via };
      cache.set(address, out);
      return out;
    } catch (e) {
      if (via === "alchemy") benchedUntil = Date.now() + COOLDOWN;
      console.warn(`balance via ${via} failed:`, (e as Error).message);
    }
  }
  return null;
}

// the cached balance when it's fresh, else one shared read; a stale balance beats an error on screen
export async function solBalance(address: string) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL) return hit;
  if (!inflight.has(address)) inflight.set(address, read(address).finally(() => inflight.delete(address)));
  const out = await inflight.get(address)!;
  return out ?? (hit ? { ...hit, stale: true } : null);
}
