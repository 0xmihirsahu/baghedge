import { bytesToHex, recoverTypedDataAddress, type Hex } from "viem";
import { isEvmAddress, isSolanaAddress, toUnits } from "../shared/amounts";
import { armHedge } from "../shared/hedge";
import { ruleFromPolicy, solanaToBytes32, verifyPolicy, type HedgePolicy } from "../shared/policy";
import type { Db, Env, RuleRecord } from "./db";
import type { Exchange } from "./exchange";
import { isRecord, RequestError } from "./http";
import { bytes32ToSolana, toUnitsRounded } from "./worker";

export type SignerConfig = {
  kind: "guard" | "fallback";
  agentAddress: Hex;
  buildHash: Hex;
};

export const COMMAND_TYPES = {
  HedgeCommand: [
    { name: "ruleId", type: "bytes32" },
    { name: "command", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

const COMMAND_MAX_AGE_MS = 5 * 60_000;

/** JSON-safe view of a rule for the browser. bigints become decimal strings. */
export function ruleView(rule: RuleRecord, db: Db) {
  const s = rule.state;
  return {
    id: rule.id, env: rule.env, status: rule.status, phase: s.phase, reason: rule.reason,
    hedgeAddress: rule.hedgeAddress, tradeAddress: rule.tradeAddress, signerKind: rule.signerKind,
    shortLots: s.shortLots.toString(), stopStatus: rule.stopStatus,
    pending: s.pending && { kind: s.pending.kind, lots: s.pending.lots.toString(), limit: s.pending.limit.toString() },
    retryUntil: s.retryUntil, policy: rule.policy,
    actions: db.actionsForRule(rule.id).map(a => ({
      id: a.id, intent: a.intent, seq: a.seq, cloid: a.cloid, stopCloid: a.stopCloid, lots: a.lots, nonce: a.nonce,
      transport: a.transport, outcome: a.outcome, oid: a.oid, filledLots: a.filledLots, error: a.error,
      createdAt: a.createdAt, updatedAt: a.updatedAt,
    })),
    fills: db.fillsForRule(rule.id),
    createdAt: rule.createdAt, updatedAt: rule.updatedAt,
  };
}

export function createHedgeRoutes(opts: {
  env: Env; db: Db; exchange: Exchange; signer: SignerConfig | null;
  readWallet(address: string): Promise<{ lamports: string; observedAt: number }>;
  onArmed?(ruleId: string): void;
  /** Addresses proven by the request's owner session. Rule reads and events require the Hedge or Trade owner. */
  sessionAddresses(req: Request): Set<string>;
}) {
  const { env, db, exchange } = opts;

  function requireOwner(req: Request, rule: RuleRecord) {
    const proven = opts.sessionAddresses(req);
    if (!proven.has(rule.hedgeAddress) && !proven.has(rule.tradeAddress)) {
      throw new RequestError(401, "sign_in_required", "Sign in as this rule's Hedge or Trade owner");
    }
  }

  async function json(req: Request) {
    if (!req.headers.get("content-type")?.startsWith("application/json")) {
      throw new RequestError(415, "expected_json", "Send a JSON request");
    }
    return req.json().catch(() => null) as Promise<unknown>;
  }

  /** Builds the unsigned policy the Hedge owner reviews and signs (EIP-712 via shared/policy.ts policyTypedData). */
  async function draft(body: unknown) {
    if (!opts.signer) throw new RequestError(503, "signer_unconfigured", "No hedge signer is configured on this server");
    if (!isRecord(body) || !isEvmAddress(body.tradeAddress) || !isEvmAddress(body.hedgeAddress) ||
      !isSolanaAddress(body.solanaAddress) || typeof body.maxSol !== "string" || typeof body.entryMark !== "string" ||
      typeof body.entryFloor !== "string" || typeof body.recoveryMark !== "string" || typeof body.exitCeiling !== "string" ||
      typeof body.expiresAt !== "number" || !Number.isSafeInteger(body.expiresAt)) {
      throw new RequestError(400, "invalid_draft", "Provide accounts, wallet, size, four prices and expiresAt (ms)");
    }
    if (body.tradeAddress.toLowerCase() === body.hedgeAddress.toLowerCase()) {
      throw new RequestError(400, "account_alias", "Trade and Hedge need different Hyperliquid accounts");
    }
    const market = await exchange.market("SOL");
    const e8 = (v: string) => { try { return toUnits(v, 8).toString(); } catch { throw new RequestError(400, "invalid_price", `Invalid price ${v}`); } };
    let capLots: string;
    try { capLots = toUnits(body.maxSol, market.sizeDecimals).toString(); } catch {
      throw new RequestError(400, "invalid_size", "Size exceeds SOL lot precision");
    }
    const ruleId = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const policy: HedgePolicy = {
      environment: env, ruleId, version: 1, policyNonce: String(Date.now()),
      tradeAccount: body.tradeAddress.toLowerCase() as Hex, hedgeAccount: body.hedgeAddress.toLowerCase() as Hex,
      watchedSolana: solanaToBytes32(body.solanaAddress), watchScope: 1, market: "SOL", assetId: market.asset,
      priceSource: "hyperliquid-mark", guardAgent: opts.signer.agentAddress, guardBuildHash: opts.signer.buildHash,
      capLots, entryTriggerE8: e8(body.entryMark), entryFloorE8: e8(body.entryFloor),
      recoveryTriggerE8: e8(body.recoveryMark), buybackCeilingE8: e8(body.exitCeiling),
      entryWindowMs: "30000", expiryMs: String(body.expiresAt), minMarginE6: "0", oneCycle: true,
    };
    try { ruleFromPolicy(policy, market.sizeDecimals); } catch (error) {
      throw new RequestError(400, "invalid_price", error instanceof Error ? error.message : "Price precision");
    }
    return { policy, signerKind: opts.signer.kind, market: { asset: market.asset, sizeDecimals: market.sizeDecimals, markPx: market.markPx } };
  }

  async function arm(body: unknown) {
    if (!opts.signer) throw new RequestError(503, "signer_unconfigured", "No hedge signer is configured on this server");
    if (!isRecord(body) || !isRecord(body.policy) || typeof body.ownerSig !== "string" || typeof body.chainId !== "number") {
      throw new RequestError(400, "invalid_hedge", "Provide policy, ownerSig and chainId");
    }
    const policy = body.policy as HedgePolicy;
    // Canonical lowercase hex only: the same signed bytes must never appear under two different ids.
    if (typeof policy.ruleId !== "string" || !/^0x[\da-f]{64}$/.test(policy.ruleId) ||
      typeof policy.hedgeAccount !== "string" || policy.hedgeAccount !== policy.hedgeAccount.toLowerCase() ||
      typeof policy.tradeAccount !== "string" || policy.tradeAccount !== policy.tradeAccount.toLowerCase()) {
      throw new RequestError(400, "non_canonical_policy", "ruleId and accounts must be lowercase hex");
    }
    let digest: Hex;
    try { ({ digest } = await verifyPolicy(policy, body.chainId, body.ownerSig as Hex)); } catch (error) {
      throw new RequestError(400, "invalid_policy", error instanceof Error ? error.message : "Invalid policy");
    }
    if (db.ruleByDigest(digest)) throw new RequestError(409, "duplicate_rule", "This signed policy was already used");
    if (policy.environment !== env) throw new RequestError(409, "wrong_environment", `This server runs ${env}`);
    if (policy.guardAgent.toLowerCase() !== opts.signer.agentAddress.toLowerCase() ||
      policy.guardBuildHash.toLowerCase() !== opts.signer.buildHash.toLowerCase()) {
      throw new RequestError(409, "wrong_signer", "Policy names a different hedge signer than this server runs");
    }
    if (db.rule(policy.ruleId)) throw new RequestError(409, "duplicate_rule", "This policy was already submitted");
    const [market, position, wallet] = await Promise.all([
      exchange.market("SOL"), exchange.position(policy.hedgeAccount, "SOL"),
      opts.readWallet(bytes32ToSolana(policy.watchedSolana)),
    ]);
    if (market.asset !== policy.assetId) throw new RequestError(409, "asset_changed", "SOL asset ID changed since review");
    const rule = ruleFromPolicy(policy, market.sizeDecimals);
    const now = Date.now();
    let state;
    try {
      state = armHedge(rule, {
        now,
        mark: { price: toUnitsRounded(market.markPx, rule.priceDecimals, "ceil"), at: market.observedAt, sequence: market.observedAt },
        wallet: { eligibleLots: BigInt(wallet.lamports) / 10n ** BigInt(9 - market.sizeDecimals), at: wallet.observedAt },
        venue: { shortLots: -toUnitsRounded(position.szi, market.sizeDecimals, "floor"), at: position.observedAt },
        book: null,
      });
    } catch (error) {
      throw new RequestError(409, "cannot_arm", error instanceof Error ? error.message : "Cannot arm");
    }
    const orders = await exchange.openOrders(policy.hedgeAccount);
    if (orders.length) throw new RequestError(409, "hedge_account_busy", "Hedge account has open orders");
    try {
      db.insertRule({ id: policy.ruleId, env, hedgeAddress: policy.hedgeAccount.toLowerCase(),
        tradeAddress: policy.tradeAccount.toLowerCase(), policy, ownerSig: body.ownerSig, chainId: body.chainId,
        signerKind: opts.signer.kind, status: "active", state, stopStatus: "none", reason: "armed" }, digest);
    } catch {
      throw new RequestError(409, "rule_active", "This Hedge account already has an active rule");
    }
    db.emit(env, policy.ruleId, "armed", { hedgeAddress: policy.hedgeAccount });
    opts.onArmed?.(policy.ruleId);
    return ruleView(db.rule(policy.ruleId)!, db);
  }

  /** Disarm or close, authorized by the Hedge owner's EIP-712 HedgeCommand signature. */
  async function command(rule: RuleRecord, command: "disarm" | "close", body: unknown) {
    if (!isRecord(body) || typeof body.signature !== "string" || typeof body.issuedAt !== "number" || typeof body.chainId !== "number") {
      throw new RequestError(400, "invalid_command", "Provide signature, issuedAt and chainId");
    }
    if (Math.abs(Date.now() - body.issuedAt) > COMMAND_MAX_AGE_MS) throw new RequestError(400, "stale_command", "Command signature expired");
    const signer = await recoverTypedDataAddress({
      domain: { name: "Baghedge", version: "1", chainId: body.chainId }, types: COMMAND_TYPES, primaryType: "HedgeCommand",
      message: { ruleId: rule.id as Hex, command, issuedAt: BigInt(body.issuedAt) }, signature: body.signature as Hex,
    }).catch(() => null);
    if (signer?.toLowerCase() !== rule.hedgeAddress) throw new RequestError(403, "not_owner", "Only the Hedge owner can do this");
    if (rule.status !== "active") return ruleView(rule, db);
    const s = rule.state;
    if (s.shortLots === 0n && !s.pending) {
      // Nothing on the venue: stop immediately. Never route a flat rule through "closing", which could still enter.
      db.updateRule(rule.id, { status: "done", reason: command === "disarm" ? "disarmed" : "closed-by-owner",
        state: { ...s, phase: "closed" } });
    } else {
      db.updateRule(rule.id, { reason: `${command}-requested`, state: { ...s, phase: "closing" } });
      opts.onArmed?.(rule.id);
    }
    db.emit(env, rule.id, command, { by: signer });
    return ruleView(db.rule(rule.id)!, db);
  }

  return {
    async route(req: Request, url: URL): Promise<unknown | undefined> {
      if (req.method === "POST" && url.pathname === "/api/hedges/draft") return draft(await json(req));
      if (req.method === "POST" && url.pathname === "/api/hedges") return arm(await json(req));
      if (req.method === "GET" && url.pathname === "/api/hedges") {
        const hedge = url.searchParams.get("hedge")?.toLowerCase();
        if (!isEvmAddress(hedge)) throw new RequestError(400, "invalid_address", "Provide ?hedge=<Hedge account>");
        if (!opts.sessionAddresses(req).has(hedge)) throw new RequestError(401, "sign_in_required", "Sign in as the Hedge owner");
        const rules = db.activeRules(env).filter(r => r.hedgeAddress === hedge);
        return { env, signer: opts.signer && { kind: opts.signer.kind, agentAddress: opts.signer.agentAddress, buildHash: opts.signer.buildHash },
          rules: rules.map(r => ruleView(r, db)) };
      }
      const match = /^\/api\/hedges\/(0x[\da-f]{64})(?:\/(disarm|close))?$/i.exec(url.pathname);
      if (!match) return undefined;
      const rule = db.rule(match[1]!.toLowerCase());
      if (!rule || rule.env !== env) throw new RequestError(404, "rule_missing", "Hedge rule not found");
      if (req.method === "GET" && !match[2]) { requireOwner(req, rule); return ruleView(rule, db); }
      if (req.method === "POST" && match[2]) return command(rule, match[2] as "disarm" | "close", await json(req));
      return undefined;
    },

    /** Server-sent events. Reconnect with ?after=<last id> (or Last-Event-ID) and refetch snapshots. */
    events(req: Request, url: URL) {
      const ruleId = url.searchParams.get("rule")?.toLowerCase();
      if (!ruleId || !/^0x[\da-f]{64}$/.test(ruleId)) throw new RequestError(400, "invalid_rule", "Provide ?rule=<rule id>");
      const owned = db.rule(ruleId);
      if (!owned || owned.env !== env) throw new RequestError(404, "rule_missing", "Hedge rule not found");
      requireOwner(req, owned);
      let after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
      let unsubscribe = () => {};
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          const send = (e: { id: number; ruleId: string | null; kind: string; data: unknown; at: number }) => {
            if (ruleId && e.ruleId !== ruleId) return;
            after = Math.max(after, e.id);
            controller.enqueue(enc.encode(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify({ ...e, data: e.data },
              (_k, v) => typeof v === "bigint" ? v.toString() : v)}\n\n`));
          };
          for (const e of db.eventsSince(env, after, ruleId)) send(e);
          unsubscribe = db.subscribe(e => { if (e.env === env) send(e); });
          keepAlive = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
        },
        cancel() { unsubscribe(); if (keepAlive) clearInterval(keepAlive); },
      });
      req.signal.addEventListener("abort", () => { unsubscribe(); if (keepAlive) clearInterval(keepAlive); });
      return stream;
    },
  };
}
