import { CancelByCloidRequest, OrderRequest } from "@nktkas/hyperliquid/api/exchange";
import { canonicalize, createL1ActionHash, signL1Action } from "@nktkas/hyperliquid/signing";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isDecimal, isRecord, RequestError } from "./http";
import { HYPERLIQUID_URL } from "./venue";

export type Network = keyof typeof HYPERLIQUID_URL;
export type Hex = `0x${string}`;
export type Signature = { r: Hex; s: Hex; v: number };
export type L1Action = Record<string, unknown>;

/** Signs Hyperliquid L1 actions as an approved agent of a master account. */
export type HedgeSigner = {
  address: Hex;
  kind: "guard" | "fallback";
  signL1(action: L1Action, nonce: number, expiresAfter?: number): Promise<Signature>;
};

/**
 * Reorders keys to the venue's field order. The L1 hash covers msgpack bytes, so `{isMarket, tpsl, triggerPx}`
 * signs a different digest than the venue recomputes and is rejected as an unknown signer. Canonicalize
 * before journaling so the stored, guard-checked, signed and submitted bodies are identical.
 */
export function canonicalAction(action: L1Action): L1Action {
  if (action.type === "order") return canonicalize(OrderRequest.entries.action, action as never) as L1Action;
  if (action.type === "cancelByCloid") return canonicalize(CancelByCloidRequest.entries.action, action as never) as L1Action;
  throw new Error(`Unsupported hedge action type: ${String(action.type)}`);
}

const AGENT_DOMAIN = {
  name: "Exchange", version: "1", chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;
const AGENT_TYPES = { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] } as const;

/** Labeled demo signer: a server-held agent key. Never the default for mainnet hedges. */
export function fallbackSigner(privateKey: Hex, network: Network): HedgeSigner {
  const wallet = privateKeyToAccount(privateKey);
  return {
    address: wallet.address.toLowerCase() as Hex,
    kind: "fallback",
    signL1: (action, nonce, expiresAfter) =>
      signL1Action({ wallet, action, nonce, expiresAfter, isTestnet: network === "testnet" }) as Promise<Signature>,
  };
}

/** Recovers the agent address from a signature over the exact action, nonce and expiry. */
export async function recoverL1Signer(
  network: Network, action: L1Action, nonce: number, signature: Signature, expiresAfter?: number,
) {
  const connectionId = createL1ActionHash({ action, nonce, expiresAfter });
  const address = await recoverTypedDataAddress({
    domain: AGENT_DOMAIN, types: AGENT_TYPES, primaryType: "Agent",
    message: { source: network === "mainnet" ? "a" : "b", connectionId },
    signature: { r: signature.r, s: signature.s, v: BigInt(signature.v) },
  });
  return { address: address.toLowerCase() as Hex, connectionId };
}

/** Wraps any signer (including the remote guard) so nothing reaches the venue unless the recovered signer matches. */
export function verifiedSigner(inner: HedgeSigner, network: Network): HedgeSigner {
  return {
    ...inner,
    async signL1(action, nonce, expiresAfter) {
      const signature = await inner.signL1(action, nonce, expiresAfter);
      const { address } = await recoverL1Signer(network, action, nonce, signature, expiresAfter);
      if (address !== inner.address) throw new Error(`Signer mismatch: expected ${inner.address}, recovered ${address}`);
      return signature;
    },
  };
}

export type OrderStatusResult =
  | { kind: "ok"; resting?: { oid: number }; filled?: { oid: number; totalSz: string; avgPx: string } }
  | { kind: "error"; message: string };

export type SubmitResult =
  | { transport: "acked"; statuses: OrderStatusResult[]; raw: unknown }
  | { transport: "rejected"; message: string; raw: unknown }
  | { transport: "unknown"; message: string };

export function createExchange(network: Network, request = fetch) {
  const base = HYPERLIQUID_URL[network];

  async function info(payload: object): Promise<unknown> {
    const response = await request(new URL("/info", base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RequestError(502, "provider_error", `Hyperliquid info returned HTTP ${response.status}`);
    }
    return response.json();
  }

  return {
    network,
    info,

    /**
     * Sends a signed action. Any transport failure is "unknown": the caller must reconcile by cloid
     * before it may treat the order as absent.
     */
    async submit(action: L1Action, nonce: number, signature: Signature, expiresAfter?: number): Promise<SubmitResult> {
      const body: Record<string, unknown> = { action, nonce, signature };
      if (expiresAfter !== undefined) body.expiresAfter = expiresAfter;
      let raw: unknown;
      try {
        const response = await request(new URL("/exchange", base), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          // A 4xx means the venue parsed and refused it; a 5xx may still have been processed.
          if (response.status >= 400 && response.status < 500) {
            return { transport: "rejected", message: `HTTP ${response.status}: ${text.slice(0, 200)}`, raw: text };
          }
          return { transport: "unknown", message: `HTTP ${response.status}` };
        }
        raw = await response.json();
      } catch (error) {
        return { transport: "unknown", message: error instanceof Error ? error.message : "network error" };
      }
      return parseExchangeResponse(raw);
    },

    /** Order status by oid or cloid, queried with the master address. */
    async orderStatus(user: string, id: number | string) {
      const result = await info({ type: "orderStatus", user, oid: id });
      if (!isRecord(result)) throw new RequestError(502, "invalid_order_status", "Hyperliquid returned no order status");
      if (result.status === "unknownOid") return null;
      const wrapper = isRecord(result.order) ? result.order : null;
      const order = wrapper && isRecord(wrapper.order) ? wrapper.order : null;
      if (!wrapper || !order || typeof wrapper.status !== "string" || typeof order.oid !== "number" ||
        !isDecimal(order.sz) || !isDecimal(order.origSz)) {
        throw new RequestError(502, "invalid_order_status", "Hyperliquid returned an unexpected order status");
      }
      return {
        status: wrapper.status, statusTimestamp: Number(wrapper.statusTimestamp ?? 0),
        oid: order.oid, remainingSz: order.sz, origSz: order.origSz,
        cloid: typeof order.cloid === "string" ? order.cloid : null,
        reduceOnly: order.reduceOnly === true, isTrigger: order.isTrigger === true,
        triggerPx: typeof order.triggerPx === "string" ? order.triggerPx : null,
        limitPx: typeof order.limitPx === "string" ? order.limitPx : null,
      };
    },

    /** Fills for one order id, de-duplicated by trade id. */
    async fillsForOrder(user: string, oid: number, since: number) {
      const result = await info({ type: "userFillsByTime", user, startTime: since, aggregateByTime: false });
      if (!Array.isArray(result)) throw new RequestError(502, "invalid_fills", "Hyperliquid returned no fills");
      const seen = new Set<number>();
      return result.flatMap(fill => {
        if (!isRecord(fill) || fill.oid !== oid || typeof fill.tid !== "number" || seen.has(fill.tid) ||
          !isDecimal(fill.sz) || !isDecimal(fill.px)) return [];
        seen.add(fill.tid);
        return [{ tid: fill.tid, sz: fill.sz, px: fill.px, side: String(fill.side), time: Number(fill.time),
          fee: typeof fill.fee === "string" ? fill.fee : "0", closedPnl: typeof fill.closedPnl === "string" ? fill.closedPnl : "0" }];
      });
    },

    /** Signed SOL position size in coin units (decimal string; short is negative) plus usable margin. */
    async position(user: string, coin: string) {
      const state = await info({ type: "clearinghouseState", user });
      if (!isRecord(state) || !Array.isArray(state.assetPositions) || !isDecimal(state.withdrawable)) {
        throw new RequestError(502, "invalid_account_data", "Hyperliquid returned incomplete account data");
      }
      const entry = state.assetPositions.find(item =>
        isRecord(item) && isRecord(item.position) && item.position.coin === coin);
      const position = isRecord(entry) && isRecord(entry.position) ? entry.position : null;
      const margin = isRecord(state.marginSummary) ? state.marginSummary : {};
      return {
        szi: position && isDecimal(position.szi) ? position.szi : "0",
        liquidationPx: position && isDecimal(position.liquidationPx) ? position.liquidationPx : null,
        withdrawable: state.withdrawable,
        accountValue: isDecimal(margin.accountValue) ? margin.accountValue : "0",
        observedAt: Date.now(),
      };
    },

    /**
     * USDC usable as margin. Standard accounts: perps `withdrawable`. Unified accounts keep USDC in spot and back
     * perps with it, so perps `withdrawable` reads 0; use the spot USDC available after maintenance instead.
     */
    async usableUsdc(user: string) {
      const [mode, state, spot] = await Promise.all([
        info({ type: "userAbstraction", user }).catch(() => null),
        info({ type: "clearinghouseState", user }),
        info({ type: "spotClearinghouseState", user }).catch(() => null),
      ]);
      const perps = isRecord(state) && isDecimal(state.withdrawable) ? state.withdrawable : "0";
      const pairs = isRecord(spot) && Array.isArray(spot.tokenToAvailableAfterMaintenance) ? spot.tokenToAvailableAfterMaintenance : [];
      const usdc = pairs.find((p: unknown) => Array.isArray(p) && p[0] === 0); // token 0 = USDC
      const spotAvailable = Array.isArray(usdc) && isDecimal(usdc[1]) ? usdc[1] : "0";
      const unified = mode === "unifiedAccount" || (mode === null && pairs.length > 0);
      // Standard accounts don't need the spot read; a unified account can't be sized without it.
      if (unified && spot === null) throw new RequestError(503, "margin_unavailable", "Couldn't read unified-account margin; try again");
      return { mode: unified ? "unified" as const : "standard" as const, usableUsdc: unified ? spotAvailable : perps,
        perpsWithdrawable: perps, spotAvailable, observedAt: Date.now() };
    },

    async openOrders(user: string) {
      const orders = await info({ type: "frontendOpenOrders", user });
      if (!Array.isArray(orders)) throw new RequestError(502, "invalid_orders", "Hyperliquid returned no open orders");
      return orders.filter(isRecord);
    },

    /** Mark price (for triggers) and the top of book (for execution bounds), as decimal strings. */
    async market(coin: string) {
      const [ctx, book] = await Promise.all([
        info({ type: "metaAndAssetCtxs" }),
        info({ type: "l2Book", coin }),
      ]);
      const universe = Array.isArray(ctx) && isRecord(ctx[0]) && Array.isArray(ctx[0].universe) ? ctx[0].universe : null;
      const contexts = Array.isArray(ctx) && Array.isArray(ctx[1]) ? ctx[1] : null;
      const asset = universe?.findIndex(item => isRecord(item) && item.name === coin && item.isDelisted !== true) ?? -1;
      const meta = universe?.[asset];
      const assetCtx = contexts?.[asset];
      const levels = isRecord(book) && Array.isArray(book.levels) ? book.levels : null;
      const topPx = (side: unknown) => Array.isArray(side) && isRecord(side[0]) && isDecimal(side[0].px) ? side[0].px : null;
      if (asset < 0 || !isRecord(meta) || typeof meta.szDecimals !== "number" || !isRecord(assetCtx) ||
        !isDecimal(assetCtx.markPx) || !levels) {
        throw new RequestError(502, "invalid_market_data", `Hyperliquid returned no ${coin} market`);
      }
      return {
        asset, sizeDecimals: meta.szDecimals, markPx: assetCtx.markPx,
        maxLeverage: typeof meta.maxLeverage === "number" ? meta.maxLeverage : 1,
        bestBid: topPx(levels[0]), bestAsk: topPx(levels[1]), observedAt: Date.now(),
      };
    },
  };
}

export type Exchange = ReturnType<typeof createExchange>;

export function parseExchangeResponse(raw: unknown): SubmitResult {
  if (!isRecord(raw)) return { transport: "unknown", message: "unparseable exchange response" };
  if (raw.status !== "ok") {
    return { transport: "rejected", message: typeof raw.response === "string" ? raw.response : "exchange error", raw };
  }
  const response = isRecord(raw.response) ? raw.response : null;
  const data = response && isRecord(response.data) ? response.data : null;
  const statuses = data && Array.isArray(data.statuses) ? data.statuses : [];
  return {
    transport: "acked", raw,
    statuses: statuses.map((status: unknown): OrderStatusResult => {
      if (isRecord(status) && typeof status.error === "string") return { kind: "error", message: status.error };
      if (isRecord(status) && isRecord(status.resting) && typeof status.resting.oid === "number") {
        return { kind: "ok", resting: { oid: status.resting.oid } };
      }
      if (isRecord(status) && isRecord(status.filled) && typeof status.filled.oid === "number") {
        return { kind: "ok", filled: {
          oid: status.filled.oid, totalSz: String(status.filled.totalSz), avgPx: String(status.filled.avgPx),
        } };
      }
      // "waitingForFill"/"waitingForTrigger" (attached children) and "success" (cancels) are ok without an oid.
      return { kind: "ok" };
    }),
  };
}
