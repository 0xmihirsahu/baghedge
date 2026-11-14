import { armHedge, decideHedge, settleHedgeOrder, type HedgeObservation, type HedgeRule } from "../shared/hedge";

const rule: HedgeRule = {
  maxLots: 600n, entryMark: 14000n, recoveryMark: 16100n,
  entryFloor: 13720n, exitCeiling: 16500n, endTime: 10_000, entryWindowMs: 3000,
};
let sequence = 0;
function snapshot(now: number, price: bigint, wallet: bigint, short: bigint): HedgeObservation {
  return {
    now, mark: { price, at: now, sequence: ++sequence },
    wallet: { eligibleLots: wallet, at: now }, venue: { shortLots: short, at: now },
    book: { bestBid: price - 1n, bestAsk: price + 1n, at: now },
  };
}

let state = armHedge(rule, snapshot(0, 14500n, 1000n, 0n));
let manualLots = 200n;
function show(label: string, wallet: bigint) {
  console.log(`${label}: ${Number(wallet + manualLots - state.shortLots) / 100} SOL net`);
}
console.log("Replay with sample prices and fills");
show("Trade account opens 2 SOL long", 1000n);
const entry = decideHedge(rule, state, snapshot(1000, 14000n, 1000n, 0n));
if (entry.action?.kind !== "entry" || entry.action.lots !== 600n) throw new Error("Expected 6 SOL hedge");
state = settleHedgeOrder(entry.state, { terminal: true, filledLots: 600n, confirmedShortLots: 600n });
show("Hedge account fills 6 SOL short", 1000n);
const resize = decideHedge(rule, state, snapshot(2000, 13900n, 500n, 600n));
if (resize.action?.kind !== "resize" || resize.action.lots !== 100n) throw new Error("Expected 1 SOL buyback");
state = resize.state;
show("5 SOL moves out, buyback pending", 500n);
state = settleHedgeOrder(state, { terminal: true, filledLots: 100n, confirmedShortLots: 500n });
show("1 SOL reduce-only buy fills", 500n);
const close = decideHedge(rule, state, snapshot(3000, 16100n, 500n, 500n));
if (close.action?.kind !== "close" || close.action.lots !== 500n) throw new Error("Expected 5 SOL close");
state = settleHedgeOrder(close.state, { terminal: true, filledLots: 500n, confirmedShortLots: 0n });
manualLots = 0n;
show("Both perp positions closed", 500n);
