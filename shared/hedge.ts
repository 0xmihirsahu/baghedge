export type HedgeRule = {
  maxLots: bigint;
  entryMark: bigint;
  recoveryMark: bigint;
  entryFloor: bigint;
  exitCeiling: bigint;
  endTime: number;
  entryWindowMs: number;
};

export type HedgeObservation = {
  now: number;
  mark: { price: bigint; at: number; sequence: number } | null;
  wallet: { eligibleLots: bigint; at: number } | null;
  venue: { shortLots: bigint; at: number } | null;
  book: { bestBid: bigint | null; bestAsk: bigint | null; at: number } | null;
};

export type HedgeAction = {
  kind: "entry" | "resize" | "close";
  lots: bigint;
  limit: bigint;
  reduceOnly: boolean;
};

export type HedgeState = {
  phase: "armed" | "opening" | "open" | "closing" | "closed" | "missed" | "expired" | "paused";
  lastMark: HedgeObservation["mark"];
  retryUntil: number | null;
  pending: HedgeAction | null;
  shortLots: bigint;
};

export type HedgeStep = { state: HedgeState; action: HedgeAction | null; reason: string };

const MARK_MAX_AGE = 5000;
const ACCOUNT_MAX_AGE = 10_000;

export function armHedge(rule: HedgeRule, observation: HedgeObservation): HedgeState {
  if (
    rule.maxLots <= 0n || rule.entryFloor <= 0n || rule.entryFloor > rule.entryMark ||
    rule.recoveryMark <= rule.entryMark || rule.exitCeiling < rule.recoveryMark ||
    !Number.isSafeInteger(rule.endTime) || rule.endTime <= observation.now ||
    !Number.isSafeInteger(rule.entryWindowMs) || rule.entryWindowMs <= 0
  ) throw new Error("Invalid hedge rule");
  const { mark, wallet, venue, now } = observation;
  if (
    !mark || !fresh(mark.at, now, MARK_MAX_AGE) || mark.price <= rule.entryMark ||
    !wallet || !fresh(wallet.at, now, ACCOUNT_MAX_AGE) || wallet.eligibleLots <= 0n ||
    !venue || !fresh(venue.at, now, ACCOUNT_MAX_AGE) || venue.shortLots !== 0n
  ) throw new Error("Arming requires fresh observations, a mark above entry, and a flat Hedge account");
  return { phase: "armed", lastMark: mark, retryUntil: null, pending: null, shortLots: 0n };
}

export function decideHedge(rule: HedgeRule, state: HedgeState, observation: HedgeObservation): HedgeStep {
  if (state.phase === "closed" || state.phase === "expired" ||
    state.phase === "missed" || state.phase === "paused") return wait(state, state.phase);

  const { now, wallet, venue, book } = observation;
  const previous = state.lastMark;
  const observed = observation.mark;
  const mark = observed && fresh(observed.at, now, MARK_MAX_AGE) &&
    (!previous || observed.sequence > previous.sequence && observed.at >= previous.at ||
      observed.sequence === previous.sequence && observed.at === previous.at && observed.price === previous.price)
    ? observed : null;
  const exitTriggered = now >= rule.endTime || (mark !== null && mark.price >= rule.recoveryMark);
  if (state.pending) {
    return wait({
      ...state,
      lastMark: mark ?? state.lastMark,
      phase: exitTriggered ? "closing" : state.phase,
    }, "awaiting-order-reconciliation");
  }
  const freshBook = book && fresh(book.at, now, MARK_MAX_AGE) ? book : null;
  const bestBid = freshBook?.bestBid ?? null;
  const bestAsk = freshBook?.bestAsk ?? null;
  if (now >= rule.endTime && state.shortLots === 0n) return wait({ ...state, phase: "expired" }, "expired");
  if (!venue || !fresh(venue.at, now, ACCOUNT_MAX_AGE)) {
    return wait(state, "venue-stale");
  }
  if (venue.shortLots !== state.shortLots) return wait({ ...state, phase: "paused" }, "unexpected-position");

  if (state.shortLots > 0n) {
    if (mark) state = { ...state, lastMark: mark };
    if (state.phase === "closing" || exitTriggered) {
      const closing = { ...state, phase: "closing" as const };
      if (bestAsk === null || bestAsk <= 0n || bestAsk > rule.exitCeiling) return wait(closing, "exit-price-outside-band");
      return reserve(closing, { kind: "close", lots: state.shortLots, limit: rule.exitCeiling, reduceOnly: true });
    }
    if (!wallet || !fresh(wallet.at, now, ACCOUNT_MAX_AGE) || wallet.eligibleLots < 0n) {
      return wait(state, "wallet-stale");
    }
    const excess = state.shortLots - wallet.eligibleLots;
    if (excess <= 0n) return wait(state, "hedge-sized");
    if (bestAsk === null || bestAsk <= 0n || bestAsk > rule.exitCeiling) return wait(state, "resize-price-outside-band");
    return reserve(state, { kind: "resize", lots: excess, limit: rule.exitCeiling, reduceOnly: true });
  }

  if (state.phase === "opening" &&
    (now >= (state.retryUntil ?? now) || (mark && mark.price >= rule.recoveryMark))) {
    return wait({ ...state, phase: "missed" }, "entry-window-ended");
  }
  if (!mark || !wallet || !fresh(wallet.at, now, ACCOUNT_MAX_AGE) || wallet.eligibleLots < 0n) {
    return wait(state.phase === "armed" ? { ...state, lastMark: null } : state, "entry-feed-stale");
  }
  if (state.phase === "armed") {
    if (previous && mark.sequence === previous.sequence) return wait(state, "old-mark");
    const crossed = previous && mark.at - previous.at <= MARK_MAX_AGE &&
      previous.price > rule.entryMark && mark.price <= rule.entryMark;
    state = { ...state, lastMark: mark };
    if (!crossed) return wait(state, "waiting-for-entry");
    state = { ...state, phase: "opening", retryUntil: Math.min(rule.endTime, now + rule.entryWindowMs) };
  }
  state = { ...state, lastMark: mark };
  if (mark.price > rule.entryMark || bestBid === null || bestBid < rule.entryFloor) {
    return wait(state, "entry-price-outside-band");
  }
  const lots = wallet.eligibleLots < rule.maxLots ? wallet.eligibleLots : rule.maxLots;
  if (lots <= 0n) return wait(state, "no-eligible-sol");
  return reserve(state, { kind: "entry", lots, limit: rule.entryFloor, reduceOnly: false });
}

export function settleHedgeOrder(
  state: HedgeState,
  order: { terminal: boolean; filledLots: bigint; confirmedShortLots: bigint },
): HedgeState {
  const action = state.pending;
  if (!action || !order.terminal) return state;
  const { filledLots, confirmedShortLots } = order;
  const expected = state.shortLots + (action.reduceOnly ? -filledLots : filledLots);
  if (filledLots < 0n || filledLots > action.lots || confirmedShortLots < 0n || expected !== confirmedShortLots) {
    throw new Error("Order fills and position do not reconcile");
  }
  if (action.kind === "entry") {
    const phase = state.phase === "closing"
      ? filledLots === 0n ? "missed" : "closing"
      : filledLots === 0n ? "opening" : "open";
    return { ...state, pending: null, shortLots: confirmedShortLots, phase };
  }
  const phase = confirmedShortLots === 0n ? "closed" : state.phase === "closing" ? "closing" : "open";
  return { ...state, pending: null, shortLots: confirmedShortLots, phase };
}

function fresh(at: number, now: number, maxAge: number) {
  return at <= now && now - at <= maxAge;
}

function wait(state: HedgeState, reason: string): HedgeStep {
  return { state, action: null, reason };
}

function reserve(state: HedgeState, action: HedgeAction): HedgeStep {
  return { state: { ...state, pending: action }, action, reason: action.kind };
}
