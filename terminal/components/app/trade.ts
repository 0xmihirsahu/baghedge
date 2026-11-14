"use client";

import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { useCallback, useEffect, useRef, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorer, getNetwork, info } from "./hl";
import type { Signer } from "./privy";

// manual trading on the Trade account (docs/INTEGRATION.md §8). wallets won't sign Hyperliquid's chain-1337 order
// payload, so a browser trading agent does: a key made here, approved once by the Trade owner through the relay.
// it can place and cancel orders, never withdraw. kept per owner and network until its approval runs out, so a new
// tab doesn't approve another one (each approval adds a named agent, and Hyperliquid caps how many an account has)

const MIN = 10; // Hyperliquid's minimum order value, in dollars
const SLIPPAGE = 0.03; // a market order is an IOC limit this far past the mark
const DAYS = 180;

type Stored = { key: `0x${string}`; until: number };
const slot = (owner: string) => `bh:trade-agent:${getNetwork()}:${owner.toLowerCase()}`;
const load = (owner: string): Stored | null => {
  try {
    const s = JSON.parse(localStorage.getItem(slot(owner)) ?? "null") as Stored | null;
    return s && s.until > Date.now() + 86_400_000 ? s : null;
  } catch {
    return null;
  }
};

// asset ids are positions in the perps universe; read once per network
let universe: { net: string; ids: Map<string, { asset: number; szDecimals: number }> } | null = null;
async function assetOf(coin: string) {
  if (!universe || universe.net !== getNetwork()) {
    const meta = await info<{ universe: { name: string; szDecimals: number }[] }>({ type: "meta" });
    universe = { net: getNetwork(), ids: new Map(meta.universe.map((u, i) => [u.name, { asset: i, szDecimals: u.szDecimals }])) };
  }
  const a = universe.ids.get(coin);
  if (!a) throw new TradeError("unknown_market", `${coin} isn't a Hyperliquid perp.`);
  return a;
}

// prices as the venue takes them: 5 significant figures, at most 6 − szDecimals decimals (AGENTS.md rule 3)
const px = (v: number, szDecimals: number) => {
  const sig = v >= 1 ? 5 - (Math.floor(Math.log10(v)) + 1) : 5 - Math.floor(Math.log10(v)) - 1;
  const d = Math.max(0, Math.min(6 - szDecimals, sig));
  return Number(v.toFixed(d)).toString();
};
const floorTo = (v: number, d: number) => Math.floor(v * 10 ** d) / 10 ** d;

export class TradeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
// the venue's refusals, in plain words
const plain = (raw: string) =>
  /insufficient margin|not enough margin/i.test(raw)
    ? "Not enough USDC in the Trade account for this order."
    : /minimum value/i.test(raw)
      ? `Orders must be worth at least $${MIN}.`
      : /could not immediately match|no liquidity/i.test(raw)
        ? "No one to match at that price. Try again."
        : /does not exist|not.*registered|user or api wallet/i.test(raw)
          ? "The Trade account needs USDC before it can trade. Add funds first."
          : /reduce only/i.test(raw)
            ? "Nothing left to close."
            : raw.replace(/^.*?:\s*/, "").slice(0, 120);

export type OrderResult = { coin: string; side: "Long" | "Short"; filled: number; avgPx: number; oid: number };

export function useTrading(o: { owner: string; signer: Signer | null; notify?: (title: string, status: string, href?: string) => void }) {
  const [busy, setBusy] = useState<null | "approve" | "order">(null);
  const [error, setError] = useState<string | null>(null);
  const signerRef = useRef(o.signer);
  const notifyRef = useRef(o.notify);
  useEffect(() => {
    signerRef.current = o.signer;
    notifyRef.current = o.notify;
  }, [o.signer, o.notify]);

  // the trading agent for this Trade owner: the stored one if Hyperliquid still lists it, or a new one approved now
  const agent = useCallback(async () => {
    const owner = o.owner;
    const signer = signerRef.current;
    if (!owner || !signer) throw new TradeError("no_signer", "Sign in to trade.");
    const kept = load(owner);
    if (kept) {
      const addr = privateKeyToAccount(kept.key).address.toLowerCase();
      const listed = await info<{ address: string }[]>({ type: "extraAgents", user: owner }).catch(() => null);
      if (!listed || listed.some((a) => a.address.toLowerCase() === addr)) return kept.key;
    }
    setBusy("approve");
    const key = generatePrivateKey();
    const agentAddress = privateKeyToAccount(key).address;
    const post = async <T,>(path: string, body: unknown) => {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new TradeError(j.error ?? "approve_failed", plain(String(j.message ?? "Couldn't approve trading.")));
      return j as T;
    };
    const { action, typedData } = await post<{ action: unknown; typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> } }>(
      "/api/hl/approve-agent",
      { agentAddress, chainId: signer.chainId(), purpose: "trade", validDays: DAYS },
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { EIP712Domain, ...types } = typedData.types;
    let signature: string;
    try {
      signature = await signer.typed(owner, { domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
    } catch (e) {
      throw new TradeError("rejected", /reject|denied|cancel/i.test(String((e as Error)?.message)) ? "You cancelled the signature." : "The wallet couldn't sign.");
    }
    await post("/api/hl/approve-agent/submit", { owner, action, signature });
    try {
      localStorage.setItem(slot(owner), JSON.stringify({ key, until: Date.now() + DAYS * 86_400_000 } satisfies Stored));
    } catch {}
    notifyRef.current?.("Trading", "Enabled", explorer("address", owner));
    return key;
  }, [o.owner]);

  // a market order: an IOC limit 3% past the mark. size in coins, rounded down to the market's lot
  const submit = useCallback(
    async (p: { coin: string; buy: boolean; size: number; mark: number; leverage?: number; reduceOnly?: boolean }) => {
      const { asset, szDecimals } = await assetOf(p.coin);
      const size = floorTo(p.size, szDecimals);
      if (size <= 0) throw new TradeError("too_small", "That's below the smallest size this market takes.");
      if (!p.reduceOnly && size * p.mark < MIN) throw new TradeError("too_small", `Orders must be worth at least $${MIN}.`);
      const key = await agent();
      setBusy("order");
      const ex = new ExchangeClient({ transport: new HttpTransport({ isTestnet: getNetwork() === "testnet" }), wallet: privateKeyToAccount(key) });
      try {
        if (p.leverage && !p.reduceOnly) await ex.updateLeverage({ asset, isCross: true, leverage: p.leverage });
        const res = await ex.order({
          orders: [{ a: asset, b: p.buy, p: px(p.mark * (p.buy ? 1 + SLIPPAGE : 1 - SLIPPAGE), szDecimals), s: size.toFixed(szDecimals), r: !!p.reduceOnly, t: { limit: { tif: "Ioc" } } }],
          grouping: "na",
        });
        const st = (res as { response: { data: { statuses: Record<string, unknown>[] } } }).response.data.statuses[0] ?? {};
        if ("error" in st) throw new TradeError("venue", plain(String(st.error)));
        const f = st.filled as { totalSz: string; avgPx: string; oid: number } | undefined;
        if (!f) throw new TradeError("not_filled", "The order didn't fill. Try again.");
        return { coin: p.coin, side: p.buy ? "Long" : "Short", filled: Number(f.totalSz), avgPx: Number(f.avgPx), oid: f.oid } as OrderResult;
      } catch (e) {
        if (e instanceof TradeError) throw e;
        throw new TradeError("venue", plain(String((e as Error)?.message ?? e)));
      }
    },
    [agent],
  );

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof TradeError ? e.message : "Something went wrong. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  // open: dollars of notional at the chosen leverage
  const open = useCallback(
    (p: { coin: string; side: "Long" | "Short"; usd: number; mark: number; leverage: number }) =>
      run(async () => {
        const r = await submit({ coin: p.coin, buy: p.side === "Long", size: p.usd / p.mark, mark: p.mark, leverage: p.leverage });
        notifyRef.current?.(`${p.side} ${p.coin}`, `Filled ${r.filled} at $${r.avgPx}`, explorer("address", o.owner));
        return r;
      }),
    [run, submit, o.owner],
  );

  // close: the whole position, reduce-only, the other way
  const close = useCallback(
    (p: { coin: string; size: number; mark: number }) =>
      run(async () => {
        const r = await submit({ coin: p.coin, buy: p.size < 0, size: Math.abs(p.size), mark: p.mark, reduceOnly: true });
        notifyRef.current?.(`${p.coin} closed`, `${r.filled} at $${r.avgPx}`, explorer("address", o.owner));
        return r;
      }),
    [run, submit, o.owner],
  );

  return { busy, error, open, close, clearError: () => setError(null) };
}
