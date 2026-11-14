import { fromUnits } from "../shared/amounts";
import { decideHedge, settleHedgeOrder, type HedgeAction, type HedgeRule, type HedgeState } from "../shared/hedge";
import { buildHedgeOrder } from "../shared/orders";
import { deriveCloid, ruleFromPolicy, type CloidIntent } from "../shared/policy";
import { StaleRuleError, type ActionRecord, type Db, type Env, type RuleRecord } from "./db";
import { GuardRefused } from "./guard";
import { canonicalAction, type Exchange, type HedgeSigner, type L1Action } from "./exchange";

export type SignContext = {
  intent: CloidIntent | "cancel";
  /** Which derived cloid this order uses. An attached child uses intent "stop" at the same seq. */
  orderRef?: { intent: "entry" | "resize" | "close" | "position_stop"; seq: number };
  entryUntilMs?: number;
  cancelRefs?: { intent: CloidIntent; seq: number }[];
};

export type WorkerDeps = {
  env: Env;
  db: Db;
  exchange: Exchange;
  readWallet(address: string): Promise<{ lamports: string; observedAt: number }>;
  /** One signer per signed rule, bound to the context of a single submission (the guard needs entryUntilMs/cancelRefs). */
  signerFor(rule: RuleRecord, context: SignContext): HedgeSigner;
  now?: () => number;
  /** Venue expiry for each signed action. The guard refuses anything over 60 s. */
  expiryMs?: number;
};

const COIN = "SOL";
// IOC orders that ended without an affirmative fill/cancel record are released only after their venue expiry plus this margin.
const EXPIRY_GRACE_MS = 5_000;
const GUARD_FAILURE_LIMIT = 3;
// Recovery-stop re-confirmation interval once the venue has confirmed it for the current position size.
const STOP_RECHECK_MS = 15_000;
// Hyperliquid's documented terminal order statuses (info endpoint, order status).
const TERMINAL = new Set(["filled", "canceled", "rejected", "marginCanceled", "vaultWithdrawalCanceled",
  "openInterestCapCanceled", "selfTradeCanceled", "reduceOnlyCanceled", "siblingFilledCanceled", "delistedCanceled",
  "liquidatedCanceled", "scheduledCancel", "tickRejected", "minTradeNtlRejected", "perpMarginRejected",
  "reduceOnlyRejected", "badAloPxRejected", "iocCancelRejected", "badTriggerPxRejected", "marketOrderNoLiquidityRejected",
  "positionIncreaseAtOpenInterestCapRejected", "positionFlipAtOpenInterestCapRejected",
  "tooAggressiveAtOpenInterestCapRejected", "openInterestIncreaseRejected", "insufficientSpotBalanceRejected",
  "oracleRejected", "perpMaxPositionRejected"]);
/** Terminal if documented, or shaped like one (…Rejected / …Canceled) for statuses the venue adds later. */
const isTerminal = (status: string) => TERMINAL.has(status) || /(Rejected|Canceled)$/.test(status);

/** Decimal string → integer units, rounding as requested when the input has extra precision. */
export function toUnitsRounded(value: string, decimals: number, mode: "floor" | "ceil"): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
  const kept = fraction.slice(0, decimals).padEnd(decimals, "0");
  let units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(kept || "0");
  if (/[1-9]/.test(fraction.slice(decimals))) units += (mode === "ceil") !== negative ? 1n : 0n;
  return negative ? -units : units;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bytes32ToSolana(hex: string): string {
  let n = BigInt(hex);
  let out = "";
  while (n > 0n) { out = BASE58[Number(n % 58n)] + out; n /= 58n; }
  const leadingZeroBytes = (hex.slice(2).match(/^(00)*/)?.[0].length ?? 0) / 2;
  return "1".repeat(leadingZeroBytes) + out;
}

export function createWorker(deps: WorkerDeps) {
  const { env, db, exchange } = deps;
  const now = deps.now ?? Date.now;
  const expiryMs = deps.expiryMs ?? 20_000;
  const locks = new Map<string, Promise<unknown>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Last venue confirmation of each rule's recovery stop (see checkStop). */
  const stopConfirmed = new Map<string, { shortLots: bigint; at: number }>();

  /** One writer per (env, hedgeAddress): ticks for the same Hedge account are serialized. */
  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    // The stored chain must never reject unhandled: one failed tick would otherwise crash the process.
    locks.set(key, run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => undefined));
    return run;
  }

  function pause(rule: RuleRecord, state: HedgeState, reason: string) {
    db.updateRule(rule.id, { state: { ...state, phase: "paused" }, reason });
    db.emit(env, rule.id, "paused", { reason });
  }

  /** Guard failures that expired unresolved: stop calling a guard that keeps failing (each call costs NEAR). */
  function pauseIfGuardKeepsFailing(ruleId: string) {
    const recent = db.actionsForRule(ruleId).filter(a => a.outcome !== null).slice(-GUARD_FAILURE_LIMIT);
    if (recent.length === GUARD_FAILURE_LIMIT &&
      recent.every(a => a.signature === null && a.error !== null && a.outcome === "zero")) {
      const current = db.rule(ruleId)!;
      if (current.state.phase !== "paused") pause(current, current.state, "guard-unavailable");
    }
  }

  async function confirmedShortLots(rule: RuleRecord, sizeDecimals: number) {
    const position = await exchange.position(rule.hedgeAddress, COIN);
    // A short is negative szi. A long on the Hedge account shows as a negative short so the engine pauses.
    return { lots: -toUnitsRounded(position.szi, sizeDecimals, "floor"), position };
  }

  async function reconcile(rule: RuleRecord, action: ActionRecord, sizeDecimals: number): Promise<boolean> {
    const status = await exchange.orderStatus(rule.hedgeAddress, action.cloid);
    let filledLots = 0n;
    let outcome: ActionRecord["outcome"];

    if (!status) {
      if (now() <= action.expiresAfter + EXPIRY_GRACE_MS) {
        // Re-sending the identical signed body is safe: the venue accepts each nonce once.
        if (action.signature && (action.transport === "signed" || action.transport === "unknown")) {
          const result = await exchange.submit(action.action as L1Action, action.nonce, action.signature as never, action.expiresAfter);
          db.updateAction(action.id, { transport: result.transport === "acked" ? "acked" : result.transport === "rejected" ? "rejected" : "unknown" });
        }
        return false;
      }
      // Past its venue expiry with no order on record: it can no longer execute.
      outcome = "zero";
    } else if (status.status === "open" || status.status === "triggered") {
      if (action.intent === "position_stop") {
        db.updateAction(action.id, { outcome: "resting", oid: status.oid, transport: "acked" });
        db.updateRule(rule.id, { stopStatus: "active" });
        db.emit(env, rule.id, "stop", { status: "active", oid: status.oid });
        return true;
      }
      return false; // an IOC can be briefly open; wait for a terminal status
    } else if (isTerminal(status.status)) {
      filledLots = toUnitsRounded(status.origSz, sizeDecimals, "floor") - toUnitsRounded(status.remainingSz, sizeDecimals, "floor");
      outcome = filledLots === 0n ? (status.status === "canceled" ? "canceled" : "zero")
        : filledLots === BigInt(action.lots) ? "filled" : "partial";
      const fills = await exchange.fillsForOrder(rule.hedgeAddress, status.oid, action.createdAt - 60_000);
      for (const fill of fills) db.recordFill(env, rule.hedgeAddress, rule.id, { ...fill, oid: status.oid });
    } else {
      // Unknown status: keep it pending, but surface it once the order is well past its venue expiry.
      if (now() > action.expiresAfter + 60_000) pause(db.rule(rule.id)!, db.rule(rule.id)!.state, `unknown-order-status:${status.status}`.slice(0, 80));
      return false;
    }

    const actionPatch = { outcome, oid: status?.oid ?? null, filledLots: filledLots.toString() };
    if (action.intent === "position_stop") {
      db.atomically(() => { db.updateAction(action.id, actionPatch); db.updateRule(rule.id, { stopStatus: "missing" }); });
      pauseIfGuardKeepsFailing(rule.id);
      return true;
    }
    // Observe the venue before writing anything: if this read fails, the action stays unresolved and is retried.
    const { lots: shortLots } = await confirmedShortLots(rule, sizeDecimals);
    const current = db.rule(rule.id)!;
    let state: HedgeState;
    let stopExplained: { stopFilled: bigint; filledStops: { cloid: string; oid: number; lots: bigint }[] } | null = null;
    try {
      state = settleHedgeOrder(current.state, { terminal: true, filledLots, confirmedShortLots: shortLots });
    } catch {
      // A recovery stop may have filled at the venue while this IOC was in flight. If our own stop fills plus this
      // fill explain the venue short exactly, settle both; otherwise it's a genuine mismatch and we pause.
      const fills = await stopFills(rule, sizeDecimals);
      const journalAfter = journalShort(rule.id, { id: action.id, intent: action.intent, filled: filledLots });
      const delta = action.intent === "entry" ? filledLots : -filledLots;
      try {
        if (fills.stopFilled === 0n || journalAfter - fills.stopFilled !== shortLots) throw new Error("unexplained");
        state = settleHedgeOrder({ ...current.state, shortLots: shortLots - delta }, { terminal: true, filledLots, confirmedShortLots: shortLots });
        stopExplained = fills;
      } catch {
        db.atomically(() => { db.updateAction(action.id, actionPatch); pause(current, current.state, "reconcile-mismatch"); });
        return true;
      }
    }
    if (stopExplained) await recordStopFills(rule, stopExplained.filledStops);
    const stopStatus = action.intent === "entry" && filledLots > 0n ? "checking" : current.stopStatus;
    // The action's outcome and the rule state it settles are one write.
    db.atomically(() => {
      db.updateAction(action.id, actionPatch);
      db.updateRule(rule.id, { state, stopStatus: stopExplained && shortLots === 0n ? "none" : stopStatus,
        reason: stopExplained ? (shortLots === 0n ? "recovery-stop-filled" : "recovery-stop-partial") : `${action.intent}-${outcome}` });
    });
    db.emit(env, rule.id, "order", { intent: action.intent, cloid: action.cloid, outcome, filledLots, shortLots });
    if (stopExplained) db.emit(env, rule.id, "stop-filled", { filledLots: stopExplained.stopFilled, shortLots, stops: stopExplained.filledStops.map(x => x.cloid) });
    pauseIfGuardKeepsFailing(rule.id);
    return true;
  }

  async function sign(rule: RuleRecord, signer: HedgeSigner, action: ActionRecord) {
    try {
      const signature = await signer.signL1(action.action as L1Action, action.nonce, action.expiresAfter);
      db.updateAction(action.id, { signature, transport: "signed" });
      return signature;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "signer error";
      if (signer.kind === "guard" && !(error instanceof GuardRefused)) {
        // A direct OutLayer run publishes the signed order in the NEAR receipt even if our RPC call fails,
        // so anyone could still submit it. Leave it unresolved; reconcile releases it only after expiry.
        db.updateAction(action.id, { transport: "unknown", error: message });
        return "unknown" as const;
      }
      // A completed guard refusal ({ok:false}, no signature) or a local fallback failure: no signature exists anywhere.
      // The outcome is written together with the settled rule state (settleZero), never alone.
      db.updateAction(action.id, { transport: "rejected", error: message });
      return null;
    }
  }

  async function send(rule: RuleRecord, action: ActionRecord, signature: unknown) {
    db.updateAction(action.id, { transport: "sent" });
    const result = await exchange.submit(action.action as L1Action, action.nonce, signature as never, action.expiresAfter);
    if (result.transport === "acked") {
      const first = result.statuses[0];
      db.updateAction(action.id, { transport: "acked", oid: first?.kind === "ok" ? first.filled?.oid ?? first.resting?.oid ?? null : null });
      if (first?.kind === "error") {
        // Affirmative venue refusal of the order itself (for an IOC: nothing matched in the band).
        db.updateAction(action.id, { error: first.message.slice(0, 300) });
        return "zero" as const;
      }
      return "acked" as const;
    }
    if (result.transport === "rejected") {
      db.updateAction(action.id, { transport: "rejected", error: result.message.slice(0, 300) });
      return "zero" as const;
    }
    db.updateAction(action.id, { transport: "unknown", error: result.message.slice(0, 300) });
    return "unknown" as const;
  }

  /**
   * Releases a pending engine action after a confirmed zero (refused signature or venue refusal). Reads the venue
   * first; then writes the action outcome and the rule state together. A failed read leaves both untouched.
   */
  async function settleZero(rule: RuleRecord, sizeDecimals: number, reason: string, actionId: string,
    outcome: "zero" | "rejected") {
    const { lots } = await confirmedShortLots(rule, sizeDecimals);
    const current = db.rule(rule.id)!;
    const patch = { outcome, filledLots: "0" } as const;
    try {
      const state = settleHedgeOrder(current.state, { terminal: true, filledLots: 0n, confirmedShortLots: lots });
      db.atomically(() => { db.updateAction(actionId, patch); db.updateRule(rule.id, { state, reason }); });
    } catch {
      // The same known-stop reconciliation as a filled IOC: a venue stop may have filled before this order was
      // refused (e.g. a reduce-only IOC rejected because the position was already gone).
      const fills = await stopFills(rule, sizeDecimals);
      if (fills.stopFilled > 0n && journalShort(rule.id) - fills.stopFilled === lots) {
        await recordStopFills(rule, fills.filledStops);
        const state = settleHedgeOrder({ ...current.state, shortLots: lots }, { terminal: true, filledLots: 0n, confirmedShortLots: lots });
        db.atomically(() => {
          db.updateAction(actionId, patch);
          db.updateRule(rule.id, { state, reason: lots === 0n ? "recovery-stop-filled" : "recovery-stop-partial",
            ...(lots === 0n ? { stopStatus: "none" as const } : {}) });
        });
        db.emit(env, rule.id, "stop-filled", { filledLots: fills.stopFilled, shortLots: lots, stops: fills.filledStops.map(x => x.cloid) });
        return;
      }
      db.atomically(() => { db.updateAction(actionId, patch); pause(current, current.state, "reconcile-mismatch"); });
    }
  }

  async function execute(rule: RuleRecord, hedgeRule: HedgeRule & { priceDecimals: number }, state: HedgeState,
    engineAction: HedgeAction, market: { asset: number; sizeDecimals: number }) {
    const intent = engineAction.kind;
    const seq = db.nextSeq(rule.id, intent);
    const cloid = deriveCloid(rule.policy.ruleId, rule.policy.version, intent, seq);
    const stopCloid = intent === "entry" ? deriveCloid(rule.policy.ruleId, rule.policy.version, "stop", seq) : null;
    const wire = canonicalAction(buildHedgeOrder(market, hedgeRule.priceDecimals, hedgeRule, engineAction,
      { order: cloid, ...(stopCloid ? { recovery: stopCloid } : {}) }));
    const signer = deps.signerFor(rule, {
      intent, orderRef: { intent, seq },
      ...(intent === "entry" && state.retryUntil !== null ? { entryUntilMs: state.retryUntil } : {}),
    });
    const nonce = db.nextNonce(signer.address);
    let expiresAfter = now() + expiryMs;
    if (intent === "entry" && state.retryUntil !== null) expiresAfter = Math.min(expiresAfter, state.retryUntil);
    const id = crypto.randomUUID();
    try {
      // Only if the rule is still active and unchanged since this decision (an owner disarm/close wins).
      db.reserveAction({ id, env, ruleId: rule.id, account: rule.hedgeAddress, intent, seq, cloid, stopCloid,
        lots: engineAction.lots.toString(), nonce, expiresAfter, signer: signer.address, action: wire }, state, rule.rev);
    } catch (error) {
      if (error instanceof StaleRuleError) return;
      throw error;
    }
    db.emit(env, rule.id, "reserved", { intent, cloid, lots: engineAction.lots, nonce });

    const reserved = db.action(id)!;
    const signature = await sign(rule, signer, reserved);
    if (signature === "unknown") return; // engine action stays pending until reconcile resolves it
    if (!signature) {
      await settleZero(rule, market.sizeDecimals, "signer-refused", id, "rejected");
      // Don't turn a rule that settleZero just reconciled as closed (e.g. by a venue stop) into "paused".
      const after = db.rule(rule.id)!;
      if (after.state.phase !== "closed") pause(after, after.state, "signer-refused");
      return;
    }
    const sent = await send(rule, db.action(id)!, signature);
    if (sent === "zero") {
      const outcome = db.action(id)!.transport === "rejected" ? "rejected" : "zero";
      return settleZero(rule, market.sizeDecimals, `${intent}-zero`, id, outcome);
    }
    await reconcile(db.rule(rule.id)!, db.action(id)!, market.sizeDecimals);
  }

  /** Confirms the recovery stop at the venue; installs a position stop if it's verified missing. */
  async function checkStop(rule: RuleRecord, hedgeRule: HedgeRule & { priceDecimals: number },
    market: { asset: number; sizeDecimals: number }) {
    const current = db.rule(rule.id)!;
    if (current.state.shortLots <= 0n || current.state.phase === "closing") return;
    // frontendOpenOrders is a heavy /info read. Once the venue has confirmed the stop for this exact position
    // size, re-confirm every STOP_RECHECK_MS instead of every tick. A size change rechecks immediately.
    const last = stopConfirmed.get(rule.id);
    if (current.stopStatus === "active" && last && last.shortLots === current.state.shortLots &&
      now() - last.at < STOP_RECHECK_MS) return;
    const orders = await exchange.openOrders(rule.hedgeAddress);
    const covering = orders.filter(order => order.coin === COIN && order.side === "B" && order.reduceOnly === true &&
      order.isTrigger === true && typeof order.triggerPx === "string" &&
      toUnitsRounded(order.triggerPx, hedgeRule.priceDecimals, "floor") === hedgeRule.recoveryMark);
    const coveredLots = covering.reduce((sum, order) => sum + toUnitsRounded(String(order.sz), market.sizeDecimals, "floor"), 0n);
    if (coveredLots >= current.state.shortLots) {
      stopConfirmed.set(rule.id, { shortLots: current.state.shortLots, at: now() });
      if (current.stopStatus !== "active") {
        db.updateRule(rule.id, { stopStatus: "active" });
        db.emit(env, rule.id, "stop", { status: "active", coveredLots });
      }
      return;
    }
    // A full parent fill places the child immediately; give one tick of slack before declaring it missing.
    if (current.stopStatus === "checking") {
      db.updateRule(rule.id, { stopStatus: "missing" });
      db.emit(env, rule.id, "stop", { status: "missing", coveredLots });
      return;
    }
    if (db.unresolvedActions(rule.id).some(action => action.intent === "position_stop")) return;
    const seq = db.nextSeq(rule.id, "position_stop");
    const cloid = deriveCloid(rule.policy.ruleId, rule.policy.version, "position_stop", seq);
    const wire = canonicalAction({ type: "order", orders: [{
      a: market.asset, b: true, p: fromUnits(hedgeRule.exitCeiling, hedgeRule.priceDecimals),
      s: fromUnits(current.state.shortLots, market.sizeDecimals), r: true,
      t: { trigger: { isMarket: false, triggerPx: fromUnits(hedgeRule.recoveryMark, hedgeRule.priceDecimals), tpsl: "sl" } },
      c: cloid,
    }], grouping: "positionTpsl" });
    const signer = deps.signerFor(rule, { intent: "position_stop", orderRef: { intent: "position_stop", seq } });
    const id = crypto.randomUUID();
    try {
      db.reserveAction({ id, env, ruleId: rule.id, account: rule.hedgeAddress, intent: "position_stop", seq, cloid,
        stopCloid: null, lots: current.state.shortLots.toString(), nonce: db.nextNonce(signer.address),
        expiresAfter: now() + expiryMs, signer: signer.address, action: wire }, current.state, current.rev);
    } catch (error) {
      if (error instanceof StaleRuleError) return;
      throw error;
    }
    const signature = await sign(rule, signer, db.action(id)!);
    if (signature === "unknown") return;
    if (!signature) {
      // A refused stop would otherwise be re-requested every tick (each guard call is paid).
      db.atomically(() => {
        db.updateAction(id, { outcome: "rejected", filledLots: "0" });
        db.updateRule(rule.id, { stopStatus: "missing" });
        pause(db.rule(rule.id)!, db.rule(rule.id)!.state, "signer-refused");
      });
      return;
    }
    if (await send(rule, db.action(id)!, signature) === "zero") {
      db.atomically(() => {
        db.updateAction(id, { outcome: db.action(id)!.transport === "rejected" ? "rejected" : "zero", filledLots: "0" });
        db.updateRule(rule.id, { stopStatus: "missing" });
      });
      return;
    }
    await reconcile(db.rule(rule.id)!, db.action(id)!, market.sizeDecimals);
  }

  /** Cancels resting stop orders this rule placed. Returns true once the venue shows none left. */
  async function cancelLeftoverOrders(rule: RuleRecord, market: { asset: number }) {
    const refs = new Map<string, { intent: CloidIntent; seq: number }>();
    for (const a of db.actionsForRule(rule.id)) {
      if (a.intent === "entry" && a.stopCloid) refs.set(a.stopCloid.toLowerCase(), { intent: "stop", seq: a.seq });
      if (a.intent === "position_stop") refs.set(a.cloid.toLowerCase(), { intent: "position_stop", seq: a.seq });
    }
    const resting = (await exchange.openOrders(rule.hedgeAddress))
      .filter(o => typeof o.cloid === "string" && refs.has(o.cloid.toLowerCase()));
    if (!resting.length) return true;
    // The guard signs at most 8 cancels per action; the rest go next tick (the venue is re-read every time).
    const cancels = resting.slice(0, 8).map(o => ({ asset: market.asset, cloid: (o.cloid as string).toLowerCase() }));
    const cancelRefs = cancels.map(c => refs.get(c.cloid)!);
    const signer = deps.signerFor(rule, { intent: "cancel", cancelRefs });
    const wire = canonicalAction({ type: "cancelByCloid", cancels });
    const id = crypto.randomUUID();
    db.reserveAction({ id, env, ruleId: rule.id, account: rule.hedgeAddress, intent: "cancel", seq: db.nextSeq(rule.id, "cancel"),
      cloid: `cancel:${id}`, stopCloid: null, lots: "0", nonce: db.nextNonce(signer.address),
      expiresAfter: now() + expiryMs, signer: signer.address, action: wire }, rule.state);
    try {
      const signature = await signer.signL1(wire, db.action(id)!.nonce, db.action(id)!.expiresAfter);
      const result = await exchange.submit(wire, db.action(id)!.nonce, signature, db.action(id)!.expiresAfter);
      // Per-leg results: an HTTP ack can still carry an error for an individual cancel. Cancels are idempotent,
      // and the venue is re-read next tick before the rule may finish, so this record is informational.
      const legErrors = result.transport === "acked"
        ? result.statuses.map((st, i) => st.kind === "error" ? `${cancels[i]?.cloid}: ${st.message}` : null).filter(Boolean)
        : [`${result.transport}: ${result.message}`];
      db.updateAction(id, { signature, transport: result.transport === "acked" ? "acked" : result.transport,
        outcome: legErrors.length ? "rejected" : "canceled", filledLots: "0",
        error: legErrors.length ? legErrors.join("; ").slice(0, 300) : null });
      db.emit(env, rule.id, "cancel-leftovers", { cloids: cancels.map(c => c.cloid), transport: result.transport });
    } catch (error) {
      db.updateAction(id, { transport: "rejected", outcome: "rejected", filledLots: "0",
        error: error instanceof Error ? error.message.slice(0, 300) : "signer error" });
    }
    return false;
  }

  /**
   * Adopts the venue short when our own stop orders (attached child or position stop) account exactly for the
   * difference between the journal and the venue. Returns false when the stops don't explain it.
   */
  /** Lots filled so far by this rule's own stop orders (attached children and position stops), from the venue. */
  async function stopFills(rule: RuleRecord, sizeDecimals: number) {
    const actions = db.actionsForRule(rule.id);
    const stopCloids = [
      ...actions.filter(a => a.intent === "entry" && a.stopCloid).map(a => a.stopCloid!),
      ...actions.filter(a => a.intent === "position_stop").map(a => a.cloid),
    ];
    let stopFilled = 0n;
    const filledStops: { cloid: string; oid: number; lots: bigint }[] = [];
    for (const cloid of stopCloids) {
      const status = await exchange.orderStatus(rule.hedgeAddress, cloid);
      if (!status) continue;
      const lots = toUnitsRounded(status.origSz, sizeDecimals, "floor") - toUnitsRounded(status.remainingSz, sizeDecimals, "floor");
      if (lots > 0n) { stopFilled += lots; filledStops.push({ cloid, oid: status.oid, lots }); }
    }
    return { stopFilled, filledStops };
  }

  /** Short implied by our own IOC fills (entries add, resizes/closes subtract), optionally with one unwritten fill. */
  function journalShort(ruleId: string, pending?: { id: string; intent: ActionRecord["intent"]; filled: bigint }) {
    return db.actionsForRule(ruleId).reduce((sum, a) => {
      const filled = pending && a.id === pending.id ? pending.filled : BigInt(a.filledLots ?? "0");
      return a.intent === "entry" ? sum + filled : a.intent === "resize" || a.intent === "close" ? sum - filled : sum;
    }, 0n);
  }

  async function recordStopFills(rule: RuleRecord, filledStops: { oid: number }[]) {
    for (const stop of filledStops) {
      const fills = await exchange.fillsForOrder(rule.hedgeAddress, stop.oid, rule.createdAt);
      for (const fill of fills) db.recordFill(env, rule.hedgeAddress, rule.id, { ...fill, oid: stop.oid });
    }
  }

  /**
   * Adopts the venue short when our own stop orders account exactly for the difference between the journal and
   * the venue. Returns false when the stops don't explain it (then the engine pauses on the mismatch).
   */
  async function settleStopFills(rule: RuleRecord, venueShort: bigint, sizeDecimals: number) {
    const { stopFilled, filledStops } = await stopFills(rule, sizeDecimals);
    if (stopFilled === 0n || journalShort(rule.id) - stopFilled !== venueShort) return false;
    await recordStopFills(rule, filledStops);
    const state = { ...rule.state, shortLots: venueShort, phase: venueShort === 0n ? "closed" as const : rule.state.phase };
    db.updateRule(rule.id, { state, reason: venueShort === 0n ? "recovery-stop-filled" : "recovery-stop-partial",
      stopStatus: venueShort === 0n ? "none" : rule.stopStatus });
    db.emit(env, rule.id, "stop-filled", { filledLots: stopFilled, shortLots: venueShort, stops: filledStops.map(s => s.cloid) });
    return true;
  }

  /** Consecutive venue refusals for this intent → when the next attempt may be signed (30 s doubling, max 10 min). */
  function refusalBackoff(ruleId: string, intent: "resize" | "close") {
    const recent = db.actionsForRule(ruleId).filter(a => a.intent === intent).reverse();
    let refusals = 0;
    for (const a of recent) {
      // A venue refusal: we signed and sent it, and the venue answered with an error and no fill.
      if ((a.outcome === "zero" || a.outcome === "rejected") && a.signature !== null && a.error) refusals++;
      else break;
    }
    if (!refusals) return null;
    const last = recent[0]!;
    return { retryAt: last.updatedAt + Math.min(30_000 * 2 ** (refusals - 1), 600_000), error: last.error!, refusals };
  }

  async function tickRule(ruleId: string) {
    const rule = db.rule(ruleId);
    if (!rule || rule.status !== "active") return;
    return withLock(`${env}:${rule.hedgeAddress}`, async () => {
      let current = db.rule(ruleId)!;
      const market = await exchange.market(COIN);
      if (market.asset !== current.policy.assetId) return pause(current, current.state, "asset-id-changed");
      const hedgeRule = ruleFromPolicy(current.policy, market.sizeDecimals);

      // 1. Reconcile anything already reserved or sent before deciding anything new.
      for (const action of db.unresolvedActions(ruleId)) {
        if (!await reconcile(current, action, market.sizeDecimals)) {
          db.updateRule(ruleId, { reason: "awaiting-order-reconciliation" });
          return;
        }
        current = db.rule(ruleId)!;
      }
      if (current.state.phase === "paused") return;

      // 1b. Repair a rule left half-written by an older build: the journal shows the action resolved but the
      // engine still holds it as pending. Settle it from the venue, the same way reconcile would have.
      if (current.state.pending) {
        const last = db.actionsForRule(ruleId).filter(a => a.intent === current.state.pending!.kind && a.outcome !== null).at(-1);
        if (last) {
          const { lots } = await confirmedShortLots(current, market.sizeDecimals);
          try {
            const state = settleHedgeOrder(current.state, { terminal: true, filledLots: BigInt(last.filledLots ?? "0"), confirmedShortLots: lots });
            db.updateRule(ruleId, { state, reason: `${last.intent}-${last.outcome}-repaired`,
              ...(last.intent === "entry" && BigInt(last.filledLots ?? "0") > 0n ? { stopStatus: "checking" as const } : {}) });
          } catch {
            pause(current, current.state, "reconcile-mismatch");
            return;
          }
          current = db.rule(ruleId)!;
        }
      }

      // 2a. A recovery stop that filled at the venue explains a smaller short: settle it as the designed exit,
      // before checking coverage (otherwise we'd re-place a stop for a position that's gone). Any other
      // unexplained change (ADL, liquidation, manual trade) still reaches the engine and pauses.
      const venueBefore = await confirmedShortLots(current, market.sizeDecimals);
      if (venueBefore.lots < current.state.shortLots && !current.state.pending &&
        await settleStopFills(current, venueBefore.lots, market.sizeDecimals)) {
        current = db.rule(ruleId)!;
      }

      // 2b. Recovery stop coverage for an open short.
      await checkStop(current, hedgeRule, market);
      current = db.rule(ruleId)!;
      if (current.state.phase === "paused") return;

      // 3. Observe and decide.
      const [{ lots: shortLots, position }, wallet] = await Promise.all([
        confirmedShortLots(current, market.sizeDecimals),
        deps.readWallet(bytes32ToSolana(current.policy.watchedSolana)).catch(() => null),
      ]);
      const at = now();
      const step = decideHedge(hedgeRule, current.state, {
        now: at,
        // Ceil the mark: entry needs mark ≤ trigger, so this never enters early.
        mark: { price: toUnitsRounded(market.markPx, hedgeRule.priceDecimals, "ceil"), at: market.markObservedAt, sequence: market.markObservedAt },
        wallet: wallet && { eligibleLots: BigInt(wallet.lamports) / 10n ** BigInt(9 - market.sizeDecimals), at: wallet.observedAt },
        venue: { shortLots, at: position.observedAt },
        book: { at: market.bookObservedAt,
          bestBid: market.bestBid ? toUnitsRounded(market.bestBid, hedgeRule.priceDecimals, "floor") : null,
          bestAsk: market.bestAsk ? toUnitsRounded(market.bestAsk, hedgeRule.priceDecimals, "ceil") : null },
      });
      if (!step.action) {
        let done = ["closed", "expired", "missed"].includes(step.state.phase);
        let reason = step.reason;
        // Flat is not finished until none of this rule's stop orders are left resting on the Hedge account.
        if (done && !await cancelLeftoverOrders(current, market)) { done = false; reason = "cancelling-hedge-orders"; }
        db.updateRule(ruleId, { state: step.state, reason, ...(done ? { status: "done" as const } : {}) });
        if (step.state.phase !== current.state.phase) db.emit(env, ruleId, "phase", { phase: step.state.phase, reason: step.reason });
        return;
      }
      // A resize/close the venue keeps refusing (e.g. below its minimum order value) would otherwise be
      // re-signed every tick, and each guard signature is paid. Back off and surface the venue's reason.
      if (step.action.kind === "resize" || step.action.kind === "close") {
        const blocked = refusalBackoff(ruleId, step.action.kind);
        if (blocked && now() < blocked.retryAt) {
          const reason = `${step.action.kind}-blocked: ${blocked.error}`.slice(0, 120);
          if (current.reason !== reason) db.updateRule(ruleId, { reason });
          return;
        }
      }
      await execute(current, hedgeRule, step.state, step.action, market);
    });
  }

  async function tickAll() {
    for (const rule of db.activeRules(env)) {
      try { await tickRule(rule.id); } catch (error) {
        console.error(`worker tick failed for ${rule.id}:`, error instanceof Error ? error.message : error);
        if (String(error).includes("429")) throw error; // let the loop back off instead of hammering the venue
      }
    }
  }

  return {
    tickRule, tickAll,
    /** Runs fn under the same per-account lock as worker ticks (owner disarm/close use this). */
    exclusive<T>(hedgeAddress: string, fn: () => Promise<T>) { return withLock(`${env}:${hedgeAddress}`, fn); },
    /**
     * Hyperliquid allows ~1200 request-weight per minute per IP and a tick costs ~50, so 4 s keeps us well under it.
     * After a rate-limit (429) the loop backs off for 30 s; the venue-side recovery stop covers the gap.
     */
    start(intervalMs = 4_000) {
      if (timer) return;
      let running = false;
      let pausedUntil = 0;
      timer = setInterval(async () => {
        if (running || Date.now() < pausedUntil) return;
        running = true;
        try { await tickAll(); }
        catch (error) {
          if (String(error).includes("429")) pausedUntil = Date.now() + 30_000;
          console.error("worker loop error:", error instanceof Error ? error.message : error);
        }
        finally { running = false; }
      }, intervalMs);
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}
