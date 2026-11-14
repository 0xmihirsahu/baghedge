import { expect, test } from "bun:test";
import { armHedge, decideHedge, settleHedgeOrder, type HedgeObservation, type HedgeRule } from "../shared/hedge";
import { buildHedgeOrder } from "../shared/orders";

const rule: HedgeRule = {
  maxLots: 600n, entryMark: 14000n, recoveryMark: 16100n, entryFloor: 13720n,
  exitCeiling: 16500n, endTime: 10_000, entryWindowMs: 3000,
};
const parentId = "0x" + "1".repeat(32);
const childId = "0x" + "2".repeat(32);

function snapshot(now: number, price: bigint, wallet = 1000n, short = 0n): HedgeObservation {
  return {
    now,
    mark: { price, at: now, sequence: now },
    wallet: { eligibleLots: wallet, at: now },
    venue: { shortLots: short, at: now },
    book: { bestBid: price - 1n, bestAsk: price + 1n, at: now },
  };
}

function openAttempt() {
  return decideHedge(rule, armHedge(rule, snapshot(0, 14500n)), snapshot(1000, 14000n));
}

test("unknown submission blocks retries; a confirmed zero fill can retry before the deadline", () => {
  const opening = openAttempt();
  expect(opening.action?.lots).toBe(600n);
  const pending = settleHedgeOrder(opening.state, { terminal: false, filledLots: 0n, confirmedShortLots: 0n });
  expect(decideHedge(rule, pending, snapshot(2000, 13900n)).reason).toBe("awaiting-order-reconciliation");
  const noFill = settleHedgeOrder(pending, { terminal: true, filledLots: 0n, confirmedShortLots: 0n });
  expect(decideHedge(rule, noFill, snapshot(2000, 13900n, 500n)).action?.lots).toBe(500n);
  expect(decideHedge(rule, noFill, snapshot(4000, 13900n)).state.phase).toBe("missed");
});

test("partial entry ends the opening cycle and a later wallet decrease buys back the excess", () => {
  const state = settleHedgeOrder(openAttempt().state, { terminal: true, filledLots: 300n, confirmedShortLots: 300n });
  expect(decideHedge(rule, state, snapshot(2000, 13900n, 1000n, 300n)).action).toBeNull();
  const resize = decideHedge(rule, state, snapshot(3000, 13900n, 200n, 300n));
  expect(resize.action).toMatchObject({ kind: "resize", lots: 100n, reduceOnly: true });
  const queued = decideHedge(rule, resize.state, snapshot(4000, 16200n, 200n, 300n));
  expect(queued.action).toBeNull();
  const resized = settleHedgeOrder(queued.state, { terminal: true, filledLots: 100n, confirmedShortLots: 200n });
  expect(decideHedge(rule, resized, snapshot(4100, 15900n, 200n, 200n)).action).toMatchObject({
    kind: "close", lots: 200n, reduceOnly: true,
  });
});

test("stale wallet reads block entry and resize but do not block a confirmed recovery exit", () => {
  const armed = armHedge(rule, snapshot(0, 14500n));
  expect(decideHedge(rule, armed, { ...snapshot(1000, 14000n), wallet: null }).action).toBeNull();
  const state = settleHedgeOrder(openAttempt().state, { terminal: true, filledLots: 600n, confirmedShortLots: 600n });
  expect(decideHedge(rule, state, { ...snapshot(2000, 13900n, 0n, 600n), wallet: null }).action).toBeNull();
  expect(decideHedge(rule, state, { ...snapshot(2000, 16100n, 0n, 600n), wallet: null }).action?.kind).toBe("close");
});

test("recovery latches when the ask exceeds the signed ceiling", () => {
  const open = settleHedgeOrder(openAttempt().state, { terminal: true, filledLots: 600n, confirmedShortLots: 600n });
  const blocked = decideHedge(rule, open, snapshot(2000, 16600n, 1000n, 600n));
  expect(blocked).toMatchObject({ reason: "exit-price-outside-band", action: null, state: { phase: "closing" } });
  expect(decideHedge(rule, blocked.state, snapshot(3000, 15900n, 1000n, 600n)).action?.kind).toBe("close");
});

test("bracket action uses a bounded IOC sell and a separate bounded reduce-only recovery buy", () => {
  const { action } = openAttempt();
  if (!action) throw new Error("Expected entry action");
  expect(buildHedgeOrder({ asset: 5, sizeDecimals: 2 }, 2, rule, action, {
    order: parentId, recovery: childId,
  })).toEqual({
    type: "order",
    grouping: "normalTpsl",
    orders: [
      { a: 5, b: false, p: "137.2", s: "6", r: false, t: { limit: { tif: "Ioc" } }, c: parentId },
      { a: 5, b: true, p: "165", s: "6", r: true,
        t: { trigger: { isMarket: false, tpsl: "sl", triggerPx: "161" } }, c: childId },
    ],
  });
  expect(() => buildHedgeOrder({ asset: 5, sizeDecimals: 2 }, 2, rule, action, {
    order: parentId, recovery: parentId,
  })).toThrow("Invalid attached recovery order");
});
