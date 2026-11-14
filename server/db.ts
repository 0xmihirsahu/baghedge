import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { HedgeState } from "../shared/hedge";
import type { HedgePolicy } from "../shared/policy";

export type Env = "testnet" | "mainnet";
export type StopStatus = "none" | "checking" | "active" | "missing";
export type Transport = "reserved" | "signed" | "sent" | "acked" | "unknown" | "rejected";
export type Outcome = "filled" | "partial" | "zero" | "rejected" | "canceled" | "resting";

export type RuleRecord = {
  id: string; env: Env; hedgeAddress: string; tradeAddress: string;
  policy: HedgePolicy; ownerSig: string; chainId: number; signerKind: "guard" | "fallback";
  status: "active" | "done"; state: HedgeState; stopStatus: StopStatus; reason: string;
  createdAt: number; updatedAt: number;
};

export type ActionRecord = {
  id: string; env: Env; ruleId: string; account: string;
  intent: "entry" | "resize" | "close" | "position_stop" | "cancel"; seq: number;
  cloid: string; stopCloid: string | null; lots: string;
  nonce: number; expiresAfter: number; signer: string; action: unknown; signature: unknown | null;
  transport: Transport; outcome: Outcome | null; oid: number | null; filledLots: string | null;
  error: string | null; createdAt: number; updatedAt: number;
};

// bigint-safe JSON: bigints are stored as {"$n":"123"}.
const encode = (value: unknown) =>
  JSON.stringify(value, (_k, v) => typeof v === "bigint" ? { $n: v.toString() } : v);
const decode = <T>(text: string): T =>
  JSON.parse(text, (_k, v) => v && typeof v === "object" && typeof v.$n === "string" && Object.keys(v).length === 1 ? BigInt(v.$n) : v);

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run(`CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY, env TEXT NOT NULL, hedge_address TEXT NOT NULL, trade_address TEXT NOT NULL,
    policy TEXT NOT NULL, owner_sig TEXT NOT NULL, chain_id INTEGER NOT NULL, signer_kind TEXT NOT NULL,
    status TEXT NOT NULL, state TEXT NOT NULL, stop_status TEXT NOT NULL, reason TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  // One active hedge rule per Hedge account and environment.
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS rules_one_active ON rules(env, hedge_address) WHERE status = 'active'");
  db.run(`CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY, env TEXT NOT NULL, rule_id TEXT NOT NULL, account TEXT NOT NULL,
    intent TEXT NOT NULL, seq INTEGER NOT NULL, cloid TEXT NOT NULL, stop_cloid TEXT, lots TEXT NOT NULL,
    nonce INTEGER NOT NULL, expires_after INTEGER NOT NULL, signer TEXT NOT NULL,
    action TEXT NOT NULL, signature TEXT, transport TEXT NOT NULL, outcome TEXT, oid INTEGER,
    filled_lots TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(env, account, cloid))`);
  db.run(`CREATE TABLE IF NOT EXISTS fills (
    env TEXT NOT NULL, account TEXT NOT NULL, tid INTEGER NOT NULL, oid INTEGER NOT NULL,
    rule_id TEXT, data TEXT NOT NULL, PRIMARY KEY(env, account, tid))`);
  db.run("CREATE TABLE IF NOT EXISTS nonces (signer TEXT PRIMARY KEY, last INTEGER NOT NULL)");
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, env TEXT NOT NULL, rule_id TEXT, kind TEXT NOT NULL,
    data TEXT NOT NULL, at INTEGER NOT NULL)`);

  const ruleRow = (row: Record<string, unknown> | null): RuleRecord | null => row && {
    id: row.id as string, env: row.env as Env, hedgeAddress: row.hedge_address as string,
    tradeAddress: row.trade_address as string, policy: JSON.parse(row.policy as string),
    ownerSig: row.owner_sig as string, chainId: row.chain_id as number,
    signerKind: row.signer_kind as RuleRecord["signerKind"], status: row.status as RuleRecord["status"],
    state: decode(row.state as string), stopStatus: row.stop_status as StopStatus, reason: row.reason as string,
    createdAt: row.created_at as number, updatedAt: row.updated_at as number,
  };
  const actionRow = (row: Record<string, unknown> | null): ActionRecord | null => row && {
    id: row.id as string, env: row.env as Env, ruleId: row.rule_id as string, account: row.account as string,
    intent: row.intent as ActionRecord["intent"], seq: row.seq as number, cloid: row.cloid as string,
    stopCloid: row.stop_cloid as string | null, lots: row.lots as string, nonce: row.nonce as number,
    expiresAfter: row.expires_after as number, signer: row.signer as string,
    action: JSON.parse(row.action as string), signature: row.signature ? JSON.parse(row.signature as string) : null,
    transport: row.transport as Transport, outcome: row.outcome as Outcome | null, oid: row.oid as number | null,
    filledLots: row.filled_lots as string | null, error: row.error as string | null,
    createdAt: row.created_at as number, updatedAt: row.updated_at as number,
  };

  const event = db.query("INSERT INTO events (env, rule_id, kind, data, at) VALUES ($env, $rule, $kind, $data, $at)");
  const listeners = new Set<(e: { id: number; env: string; ruleId: string | null; kind: string; data: unknown; at: number }) => void>();

  const api = {
    raw: db,
    insertRule(rule: Omit<RuleRecord, "createdAt" | "updatedAt">) {
      const now = Date.now();
      db.query(`INSERT INTO rules VALUES ($id, $env, $hedge, $trade, $policy, $sig, $chain, $kind, $status, $state, $stop, $reason, $now, $now)`)
        .run({ id: rule.id, env: rule.env, hedge: rule.hedgeAddress, trade: rule.tradeAddress,
          policy: JSON.stringify(rule.policy), sig: rule.ownerSig, chain: rule.chainId, kind: rule.signerKind,
          status: rule.status, state: encode(rule.state), stop: rule.stopStatus, reason: rule.reason, now });
    },
    rule(id: string) { return ruleRow(db.query("SELECT * FROM rules WHERE id = $id").get({ id }) as Record<string, unknown> | null); },
    activeRules(env: Env) {
      return (db.query("SELECT * FROM rules WHERE env = $env AND status = 'active'").all({ env }) as Record<string, unknown>[])
        .map(row => ruleRow(row)!);
    },
    updateRule(id: string, patch: Partial<Pick<RuleRecord, "state" | "status" | "stopStatus" | "reason">>) {
      const current = api.rule(id);
      if (!current) throw new Error("rule missing");
      const next = { ...current, ...patch };
      db.query("UPDATE rules SET state = $state, status = $status, stop_status = $stop, reason = $reason, updated_at = $now WHERE id = $id")
        .run({ id, state: encode(next.state), status: next.status, stop: next.stopStatus, reason: next.reason, now: Date.now() });
      return next;
    },

    /** Monotonic per-signer nonce: max(now, last + 1), persisted before use. */
    nextNonce(signer: string) {
      return db.transaction(() => {
        const row = db.query("SELECT last FROM nonces WHERE signer = $signer").get({ signer }) as { last: number } | null;
        const nonce = Math.max(Date.now(), (row?.last ?? 0) + 1);
        db.query("INSERT INTO nonces VALUES ($signer, $nonce) ON CONFLICT(signer) DO UPDATE SET last = $nonce").run({ signer, nonce });
        return nonce;
      })();
    },

    /** Records a reservation and the rule state that produced it in one transaction. */
    reserveAction(action: Omit<ActionRecord, "createdAt" | "updatedAt" | "signature" | "outcome" | "oid" | "filledLots" | "error" | "transport">, state: HedgeState) {
      const now = Date.now();
      db.transaction(() => {
        db.query(`INSERT INTO actions (id, env, rule_id, account, intent, seq, cloid, stop_cloid, lots, nonce, expires_after,
          signer, action, transport, created_at, updated_at) VALUES ($id, $env, $rule, $account, $intent, $seq, $cloid, $stop,
          $lots, $nonce, $expires, $signer, $action, 'reserved', $now, $now)`)
          .run({ id: action.id, env: action.env, rule: action.ruleId, account: action.account, intent: action.intent,
            seq: action.seq, cloid: action.cloid, stop: action.stopCloid, lots: action.lots, nonce: action.nonce,
            expires: action.expiresAfter, signer: action.signer, action: JSON.stringify(action.action), now });
        db.query("UPDATE rules SET state = $state, updated_at = $now WHERE id = $id").run({ id: action.ruleId, state: encode(state), now });
      })();
    },
    updateAction(id: string, patch: Partial<Pick<ActionRecord, "signature" | "transport" | "outcome" | "oid" | "filledLots" | "error">>) {
      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id, now: Date.now() };
      for (const [key, value] of Object.entries(patch)) {
        const column = key.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
        sets.push(`${column} = $${key}`);
        params[key] = key === "signature" ? JSON.stringify(value) : value as string | number | null;
      }
      db.query(`UPDATE actions SET ${sets.join(", ")}, updated_at = $now WHERE id = $id`).run(params);
    },
    action(id: string) { return actionRow(db.query("SELECT * FROM actions WHERE id = $id").get({ id }) as Record<string, unknown> | null); },
    /** Actions not yet resolved by venue evidence. */
    unresolvedActions(ruleId: string) {
      return (db.query("SELECT * FROM actions WHERE rule_id = $rule AND outcome IS NULL ORDER BY created_at").all({ rule: ruleId }) as Record<string, unknown>[])
        .map(row => actionRow(row)!);
    },
    actionsForRule(ruleId: string) {
      return (db.query("SELECT * FROM actions WHERE rule_id = $rule ORDER BY created_at").all({ rule: ruleId }) as Record<string, unknown>[])
        .map(row => actionRow(row)!);
    },
    nextSeq(ruleId: string, intent: string) {
      const row = db.query("SELECT COUNT(*) AS n FROM actions WHERE rule_id = $rule AND intent = $intent").get({ rule: ruleId, intent }) as { n: number };
      return row.n;
    },
    recordFill(env: Env, account: string, ruleId: string | null, fill: { tid: number; oid: number } & Record<string, unknown>) {
      db.query("INSERT OR IGNORE INTO fills VALUES ($env, $account, $tid, $oid, $rule, $data)")
        .run({ env, account, tid: fill.tid, oid: fill.oid, rule: ruleId, data: JSON.stringify(fill) });
    },
    fillsForRule(ruleId: string) {
      return (db.query("SELECT data FROM fills WHERE rule_id = $rule ORDER BY tid").all({ rule: ruleId }) as { data: string }[])
        .map(row => JSON.parse(row.data));
    },

    emit(env: Env, ruleId: string | null, kind: string, data: unknown) {
      const at = Date.now();
      const result = event.run({ env, rule: ruleId, kind, data: encode(data), at });
      const record = { id: Number(result.lastInsertRowid), env, ruleId, kind, data: decode(encode(data)), at };
      for (const listener of listeners) listener(record);
    },
    eventsSince(env: Env, after: number, ruleId?: string) {
      const rows = db.query(`SELECT * FROM events WHERE env = $env AND id > $after ${ruleId ? "AND rule_id = $rule" : ""} ORDER BY id LIMIT 500`)
        .all(ruleId ? { env, after, rule: ruleId } : { env, after }) as Record<string, unknown>[];
      return rows.map(row => ({ id: row.id as number, env: row.env as string, ruleId: row.rule_id as string | null,
        kind: row.kind as string, data: decode(row.data as string), at: row.at as number }));
    },
    subscribe(listener: Parameters<typeof listeners.add>[0]) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { db.close(); },
  };
  return api;
}

export type Db = ReturnType<typeof openDb>;
