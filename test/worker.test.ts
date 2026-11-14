import { describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import { armHedge } from "../shared/hedge";
import { ruleFromPolicy, solanaToBytes32, type HedgePolicy } from "../shared/policy";
import { openDb } from "../server/db";
import { fallbackSigner, verifiedSigner, type Exchange, type L1Action, type HedgeSigner, type OrderStatusResult, type SubmitResult } from "../server/exchange";
import { GuardRefused } from "../server/guard";
import { createWorker, type SignContext } from "../server/worker";

type Order = { cloid: string; oid: number; buy: boolean; reduceOnly: boolean; trigger?: string; origLots: number; filledLots: number; status: string; parent?: string };

/** A minimal in-memory venue: IOC orders fill per `fill`, attached stops activate on a full parent fill. */
let clock = () => Date.now();
function fakeVenue() {
  const v = {
    mark: "75", bid: "74.9", ask: "75.1", shortLots: 0, nextOid: 1,
    orders: new Map<string, Order>(),
    fill: "full" as "full" | "half" | "zero" | "timeout",
    submissions: 0, cancels: 0, lamports: 1_000_000_000n, // 1 SOL in the watched wallet
  };
  const lots = (s: string) => Math.round(Number(s) * 100);
  const exchange = {
    network: "testnet",
    info: async () => null,
    async market() {
      return { asset: 0, sizeDecimals: 2, markPx: v.mark, bestBid: v.bid, bestAsk: v.ask, observedAt: clock() };
    },
    async position() {
      return { szi: (-v.shortLots / 100).toString(), liquidationPx: null, withdrawable: "30", accountValue: "30", observedAt: clock() };
    },
    async orderStatus(_user: string, cloid: string) {
      const o = v.orders.get(cloid as string);
      if (!o) return null;
      return { status: o.status, statusTimestamp: 0, oid: o.oid, remainingSz: ((o.origLots - o.filledLots) / 100).toString(),
        origSz: (o.origLots / 100).toString(), cloid: o.cloid, reduceOnly: o.reduceOnly, isTrigger: !!o.trigger, triggerPx: o.trigger ?? null, limitPx: null };
    },
    async fillsForOrder() { return []; },
    async openOrders() {
      return [...v.orders.values()].filter(o => o.status === "open" && o.trigger)
        .map(o => ({ coin: "SOL", side: "B", reduceOnly: true, isTrigger: true, triggerPx: o.trigger, sz: ((o.origLots) / 100).toString(), cloid: o.cloid }));
    },
    async submit(action: L1Action): Promise<SubmitResult> {
      if (action.type === "cancelByCloid") {
        v.cancels++;
        for (const c of action.cancels as { cloid: string }[]) { const o = v.orders.get(c.cloid); if (o) o.status = "canceled"; }
        return { transport: "acked", statuses: [{ kind: "ok" }], raw: null };
      }
      v.submissions++;
      const orders = action.orders as { b: boolean; s: string; r: boolean; c: string; t: { limit?: unknown; trigger?: { triggerPx: string } } }[];
      const statuses: OrderStatusResult[] = [];
      for (const o of orders) {
        const order: Order = { cloid: o.c, oid: v.nextOid++, buy: o.b, reduceOnly: o.r, origLots: lots(o.s), filledLots: 0, status: "open" };
        if (o.t.trigger) {
          order.trigger = o.t.trigger.triggerPx;
          const parent = [...v.orders.values()].at(-1);
          // positionTpsl stops rest immediately; normalTpsl children only after a complete parent fill.
          order.status = action.grouping === "positionTpsl" || (parent && parent.filledLots === parent.origLots) ? "open" : "canceled";
          v.orders.set(o.c, order);
          continue;
        }
        const want = order.origLots;
        const filled = o.r ? Math.min(want, v.shortLots) : v.fill === "zero" ? 0 : v.fill === "half" ? Math.floor(want / 2) : want;
        order.filledLots = filled;
        order.status = filled === want ? "filled" : "canceled";
        if (filled > 0 || v.fill !== "zero") v.orders.set(o.c, order);
        v.shortLots += o.r ? -filled : filled;
        statuses.push(filled > 0 ? { kind: "ok", filled: { oid: order.oid, totalSz: (filled / 100).toString(), avgPx: v.mark } }
          : { kind: "error", message: "Order could not immediately match against any resting orders." });
      }
      if (v.fill === "timeout") return { transport: "unknown", message: "timeout" };
      return { transport: "acked", statuses, raw: null };
    },
  } as unknown as Exchange;
  return { v, exchange };
}

const policy: HedgePolicy = {
  environment: "testnet", ruleId: `0x${"ab".repeat(32)}`, version: 1, policyNonce: "1",
  tradeAccount: "0x1111111111111111111111111111111111111111", hedgeAccount: "0x3333333333333333333333333333333333333333",
  watchedSolana: solanaToBytes32("So11111111111111111111111111111111111111112"), watchScope: 1, market: "SOL", assetId: 0,
  priceSource: "hyperliquid-mark", guardAgent: "0x2222222222222222222222222222222222222222", guardBuildHash: `0x${"cd".repeat(32)}`,
  capLots: "40", entryTriggerE8: "7000000000", entryFloorE8: "6860000000", recoveryTriggerE8: "8050000000",
  buybackCeilingE8: "8200000000", entryWindowMs: "30000", expiryMs: String(Date.now() + 3_600_000), minMarginE6: "1", oneCycle: true,
};

function setupWith(custom: HedgeSigner) { return setup("fallback", custom); }
function setupRecording() {
  const contexts: SignContext[] = [];
  const s = setup("fallback", undefined, c => contexts.push(c));
  return { ...s, contexts };
}
function setup(signerMode: "fallback" | "guard-publishes-then-throws" | "guard-down" = "fallback", custom?: HedgeSigner,
  record?: (context: SignContext) => void) {
  const { v, exchange } = fakeVenue();
  const db = openDb(":memory:");
  const local = fallbackSigner(generatePrivateKey(), "testnet");
  const signer: HedgeSigner = custom ? custom : signerMode === "fallback" ? verifiedSigner(local, "testnet")
    : signerMode === "guard-down" ? { address: local.address, kind: "guard", signL1: async () => { throw new Error("OutLayer 503"); } } : {
    address: local.address, kind: "guard",
    async signL1(action, nonce, expiresAfter) {
      // The guard signed and the receipt is public; a third party submits it before our RPC call fails.
      const signature = await local.signL1(action, nonce, expiresAfter);
      await exchange.submit(action, nonce, signature, expiresAfter);
      throw new Error("NEAR RPC timeout");
    },
  };
  const rule = ruleFromPolicy(policy, 2);
  const now = Date.now();
  const state = armHedge(rule, {
    now, mark: { price: 750000n, at: now, sequence: now }, wallet: { eligibleLots: 100n, at: now },
    venue: { shortLots: 0n, at: now }, book: null,
  });
  db.insertRule({ id: "r1", env: "testnet", hedgeAddress: policy.hedgeAccount.toLowerCase(), tradeAddress: policy.tradeAccount,
    policy, ownerSig: "0x", chainId: 1, signerKind: "fallback", status: "active", state, stopStatus: "none", reason: "armed" }, "0xdigest");
  const worker = createWorker({
    env: "testnet", db, exchange, signerFor: (_rule, context) => { record?.(context); return signer; }, now: () => clock(),
    readWallet: async () => ({ lamports: v.lamports.toString(), observedAt: clock() }),
  });
  const tick = async () => { await Bun.sleep(2); await worker.tickRule("r1"); return db.rule("r1")!; };
  return { v, db, tick };
}

describe("worker", () => {
  test("full flow: cross → entry with confirmed stop → wallet drop resize → recovery close", async () => {
    const { v, db, tick } = setup();
    expect((await tick()).state.phase).toBe("armed");
    v.mark = "69.9"; v.bid = "69.8"; v.ask = "70";
    let rule = await tick();
    expect(rule.state.phase).toBe("open");
    expect(rule.state.shortLots).toBe(40n);   // min(cap 0.40, wallet 1.00)
    expect(rule.stopStatus).toBe("checking");
    rule = await tick();
    expect(rule.stopStatus).toBe("active");   // child confirmed from venue open orders

    v.lamports = 250_000_000n;                // 0.75 SOL leaves the watched wallet
    rule = await tick();
    expect(rule.state.shortLots).toBe(25n);   // reduce-only buyback of 0.15
    const resize = db.actionsForRule("r1").find(a => a.intent === "resize")!;
    expect(resize.outcome).toBe("filled");
    expect((resize.action as { orders: { r: boolean }[] }).orders[0]!.r).toBe(true);

    v.mark = "80.6"; v.ask = "80.7";          // recovery trigger crossed
    rule = await tick();
    expect(rule.state.phase).toBe("closed");
    expect(v.shortLots).toBe(0);
    rule = await tick();                      // attached stop still resting → cancel it, not done yet
    expect(rule).toMatchObject({ status: "active", reason: "cancelling-hedge-orders" });
    expect(v.cancels).toBe(1);
    const cancel = db.actionsForRule("r1").find(a => a.intent === "cancel")!;
    expect((cancel.action as { type: string }).type).toBe("cancelByCloid");
    rule = await tick();                      // venue shows nothing left → done
    expect(rule.status).toBe("done");
  });

  test("an unknown send is reconciled, never re-sent as a second sell", async () => {
    const { v, db, tick } = setup();
    await tick();
    v.mark = "69.9"; v.bid = "69.8"; v.fill = "timeout";
    let rule = await tick();
    expect(v.shortLots).toBe(40);             // the venue did fill it
    v.fill = "full";
    rule = await tick();                      // reconcile by cloid
    rule = await tick();
    expect(rule.state.shortLots).toBe(40n);
    expect(db.actionsForRule("r1").filter(a => a.intent === "entry")).toHaveLength(1);
    expect(v.shortLots).toBe(40);
  });

  test("a partial entry ends opening and installs a position stop for what filled", async () => {
    const { v, db, tick } = setup();
    await tick();
    v.mark = "69.9"; v.bid = "69.8"; v.fill = "half";
    let rule = await tick();
    expect(rule.state).toMatchObject({ phase: "open", shortLots: 20n });
    rule = await tick();                      // attached child was canceled with the partial parent
    expect(rule.stopStatus).toBe("missing");
    rule = await tick();
    expect(rule.stopStatus).toBe("active");
    const stop = db.actionsForRule("r1").find(a => a.intent === "position_stop")!;
    expect((stop.action as { grouping: string }).grouping).toBe("positionTpsl");
    expect(db.actionsForRule("r1").filter(a => a.intent === "entry")).toHaveLength(1);
  });

  test("a guard error is not a zero: a published order that fills is reconciled, never re-sent", async () => {
    const { v, db, tick } = setup("guard-publishes-then-throws");
    await tick();
    v.mark = "69.9"; v.bid = "69.8";
    let rule = await tick();
    const [entry] = db.actionsForRule("r1");
    expect(entry).toMatchObject({ intent: "entry", transport: "unknown", outcome: null });
    expect(rule.state.pending?.kind).toBe("entry");   // still pending, not released as zero
    rule = await tick();
    expect(rule.state).toMatchObject({ phase: "open", shortLots: 40n });
    expect(db.actionsForRule("r1").filter(a => a.intent === "entry")).toHaveLength(1);
    expect(v.submissions).toBe(1);
  });

  test("repeated guard failures that expire unresolved pause the rule instead of retrying forever", async () => {
    let t = Date.now();
    clock = () => t;
    try {
      const { v, db, tick } = setup("guard-down");
      const rule0 = db.rule("r1")!;
      // Open position already, so the engine wants a resize (no entry window to end the retries).
      db.updateRule("r1", { state: { ...rule0.state, phase: "open", shortLots: 40n } });
      v.shortLots = 40; v.lamports = 200_000_000n;
      for (let i = 0; i < 12 && db.rule("r1")!.state.phase !== "paused"; i++) {
        t += 13_000; await tick();          // past expiresAfter (20 s) + grace (5 s) every two ticks
      }
      const rule = db.rule("r1")!;
      expect(rule.state.phase).toBe("paused");
      expect(rule.reason).toBe("guard-unavailable");
      // Paused at the third expired guard failure (resize and position-stop attempts both count).
      const attempts = db.actionsForRule("r1").length;
      expect(attempts).toBeLessThanOrEqual(4);      // at most one attempt was already in flight
      for (let i = 0; i < 4; i++) { t += 13_000; await tick(); }
      expect(db.actionsForRule("r1")).toHaveLength(attempts);   // nothing new after the pause
      expect(v.submissions).toBe(0);
    } finally { clock = () => Date.now(); }
  });

  test("an explicit guard refusal is a confirmed zero and pauses the rule immediately", async () => {
    const { v, db, tick } = setupWith({ address: "0x5a272d74b33a28c540116f24433b4fb0c74e0337", kind: "guard",
      signL1: async () => { throw new GuardRefused("price_out_of_bounds"); } });
    await tick();
    v.mark = "69.9"; v.bid = "69.8";
    const rule = await tick();
    expect(rule.state.phase).toBe("paused");
    expect(rule.reason).toBe("signer-refused");
    expect(db.actionsForRule("r1")[0]).toMatchObject({ outcome: "rejected", transport: "rejected" });
    expect(v.submissions).toBe(0);
  });

  test("a refused position stop pauses the rule instead of re-requesting it every tick", async () => {
    let calls = 0;
    const { v, db, tick } = setupWith({ address: "0x5a272d74b33a28c540116f24433b4fb0c74e0337", kind: "guard",
      signL1: async () => { calls++; throw new GuardRefused("stop_out_of_bounds"); } });
    const r = db.rule("r1")!;
    db.updateRule("r1", { state: { ...r.state, phase: "open", shortLots: 40n } });
    v.shortLots = 40;
    for (let i = 0; i < 4; i++) await tick();
    const rule = db.rule("r1")!;
    expect(rule).toMatchObject({ reason: "signer-refused", stopStatus: "missing" });
    expect(rule.state.phase).toBe("paused");
    expect(calls).toBe(1);
  });

  test("each signing request carries the orderRef that derived its cloid", async () => {
    const { v, db, tick, contexts } = setupRecording();
    await tick();
    v.mark = "69.9"; v.bid = "69.8"; v.fill = "half";
    await tick(); await tick(); await tick();
    const entry = db.actionsForRule("r1").find(a => a.intent === "entry")!;
    const stop = db.actionsForRule("r1").find(a => a.intent === "position_stop")!;
    expect(contexts).toContainEqual(expect.objectContaining({ intent: "entry", orderRef: { intent: "entry", seq: entry.seq } }));
    expect(contexts).toContainEqual(expect.objectContaining({ intent: "position_stop", orderRef: { intent: "position_stop", seq: stop.seq } }));
  });

  test("a gap below the entry floor sends nothing", async () => {
    const { v, db, tick } = setup();
    await tick();
    v.mark = "68"; v.bid = "67.5";            // bid under the 68.60 floor
    const rule = await tick();
    expect(rule.state.phase).toBe("opening");
    expect(v.submissions).toBe(0);
    expect(db.actionsForRule("r1")).toHaveLength(0);
  });
});
