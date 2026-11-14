import { keccak256, stringToHex } from "viem";
import { fromUnits, isEvmAddress, isSolanaAddress } from "../shared/amounts";
import { previewHedge } from "./preview";
import { RequestError } from "./http";
import { createIntents, parseQuoteInput } from "./intents";
import { openTransfers } from "./transfers";
import { createVenue, readSolBalance } from "./venue";
import { openDb } from "./db";
import { serveOps } from "./ops/serve";
import { createSessions } from "./session";
import { createOwnerActions } from "./owner";
import * as guardModule from "./guard";
import { createGuardSigner, outLayerExecutorFromEnv } from "./guard";
import { createExchange, fallbackSigner, verifiedSigner, type HedgeSigner, type Hex } from "./exchange";
import { createHedgeRoutes, type SignerConfig } from "./hedges";
import { createWorker, toUnitsRounded, type SignContext } from "./worker";
import type { RuleRecord } from "./db";

type AppConfig = {
  mode: "testnet" | "mainnet";
  appOrigin?: string;
  dbPath: string;
  solanaRpc: string;
  intentsUrl?: string;
  intentsJwt?: string;
  /** Hedge signer. Absent: hedge routes report signer_unconfigured and the worker doesn't run. */
  signer?: SignerConfig & { signerFor(rule: RuleRecord, context: SignContext): HedgeSigner };
  worker?: boolean;
};

export function createApi(config: AppConfig, request = fetch) {
  const venue = createVenue(config.mode, request);
  const intents = createIntents(config.intentsUrl, config.intentsJwt, request);
  const transfers = openTransfers(config.dbPath);
  const db = openDb(config.dbPath);
  const exchange = createExchange(config.mode, request);
  const readWallet = (address: string) => readSolBalance(config.solanaRpc, address, request);
  const worker = config.signer
    ? createWorker({ env: config.mode, db, exchange, readWallet, signerFor: config.signer.signerFor })
    : null;
  const owner = createOwnerActions(config.mode, request);
  const sessions = createSessions({
    env: config.mode, db, origin: config.appOrigin ?? "http://localhost:3001",
    secureCookie: (config.appOrigin ?? "").startsWith("https://"),
  });
  const hedges = createHedgeRoutes({
    env: config.mode, db, exchange, readWallet, signer: config.signer ?? null,
    sessionAddresses: req => sessions.addresses(req),
    exclusive: (hedge, fn) => worker ? worker.exclusive(hedge, fn) : fn(),
    // Prompted ticks follow the same switch as the timer: with WORKER=0 this instance never writes to the venue.
    onArmed: id => { if (config.worker) void worker?.tickRule(id).catch(error => console.error("hedge tick failed", error)); },
  });
  if (worker && config.worker) worker.start();

  async function route(req: Request, url: URL) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return {
        mode: config.mode, executableQuotesEnabled: config.mode === "mainnet",
        hedgeSigner: config.signer
          ? { kind: config.signer.kind, agentAddress: config.signer.agentAddress, buildHash: config.signer.buildHash,
              pinnedOwner: config.signer.pinnedOwner ?? null, multiOwner: Boolean(config.signer.agentFor) }
          : null,
        // Shown to users before they fund a Hedge account (README "Trust boundary and disclosed risks").
        disclosures: process.env.EXECUTOR_KEY_DISCLOSURE === "1"
          ? ["The guard's NEAR execution account key was exposed during development and has not been rotated. A holder could request extra hedge orders within a user's signed policy limits (trading the Hedge account's margin); it can never withdraw funds."]
          : [],
        workerRunning: Boolean(worker && config.worker),
      };
    }
    if (req.method === "GET" && url.pathname === "/api/markets") {
      return { mode: config.mode, markets: await venue.markets() };
    }
    if (req.method === "GET" && url.pathname === "/api/accounts") {
      const trade = url.searchParams.get("trade");
      const hedge = url.searchParams.get("hedge");
      if (!isEvmAddress(trade) || (hedge !== null && !isEvmAddress(hedge))) {
        throw new RequestError(400, "invalid_address", "Provide a Trade address and an optional Hedge address");
      }
      if (trade.toLowerCase() === hedge?.toLowerCase()) {
        throw new RequestError(400, "account_alias", "Trade and Hedge need different Hyperliquid accounts");
      }
      const withMargin = async (address: string) => {
        const [account, margin] = await Promise.all([venue.account(address), exchange.usableUsdc(address).catch(() => null)]);
        // A failed margin read degrades to "unknown" instead of failing the whole account read.
        if (!margin) return { ...account, accountMode: "unknown" as const, usableUsdc: null, maxPayoutUsdc: null };
        // usableUsdc is what the UI should show as margin; maxPayoutUsdc leaves room for the 1 USDC sendAsset fee.
        const usable = toUnitsRounded(margin.usableUsdc, 6, "floor");
        const maxPayout = usable > 1_200_000n ? usable - 1_200_000n : 0n;
        return { ...account, accountMode: margin.mode, usableUsdc: margin.usableUsdc, maxPayoutUsdc: fromUnits(maxPayout, 6) };
      };
      const [tradeAccount, hedgeAccount] = await Promise.all([
        withMargin(trade.toLowerCase()),
        hedge ? withMargin(hedge.toLowerCase()) : null,
      ]);
      return { mode: config.mode, trade: tradeAccount, hedge: hedgeAccount };
    }
    if (req.method === "GET" && url.pathname === "/api/wallet/sol") {
      const address = url.searchParams.get("address");
      if (!isSolanaAddress(address)) throw new RequestError(400, "invalid_address", "Provide a Solana wallet address");
      return { mode: config.mode, ...await readSolBalance(config.solanaRpc, address, request) };
    }
    if (req.method === "POST" && (url.pathname === "/api/transfers/quote" || url.pathname === "/api/hedges/preview")) {
      if (!req.headers.get("content-type")?.startsWith("application/json")) {
        throw new RequestError(415, "expected_json", "Send a JSON request");
      }
      const body: unknown = await req.json().catch(() => null);
      if (url.pathname === "/api/hedges/preview") {
        return {
          mode: config.mode,
          ...await previewHedge(body, venue, address => readSolBalance(config.solanaRpc, address, request)),
        };
      }
      const input = parseQuoteInput(body);
      if (!input.dry && config.mode !== "mainnet") {
        throw new RequestError(409, "mainnet_only", "Executable Intents quotes require mainnet mode");
      }
      const quote = await intents.quote(input);
      const id = quote.dry ? null : transfers.save(config.mode, quote);
      return { id, mode: "mainnet", ...quote };
    }
    // Owner-signed Hyperliquid actions: build → wallet signs → relay (signer checked server-side).
    if (req.method === "POST" && (url.pathname === "/api/hl/approve-agent" || url.pathname === "/api/hl/approve-agent/submit")) {
      if (!req.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "expected_json", "Send a JSON request");
      const body: unknown = await req.json().catch(() => null);
      if (url.pathname === "/api/hl/approve-agent") return owner.approveAgent(body);
      const signerAddr = (body as { owner?: unknown })?.owner;
      if (!isEvmAddress(signerAddr)) throw new RequestError(400, "invalid_owner", "Provide owner (the account approving the agent)");
      return owner.submit(body, { expectedSigner: signerAddr });
    }
    const hedgeResult = await hedges.route(req, url);
    if (hedgeResult !== undefined) return hedgeResult;
    if (req.method === "GET" && url.pathname === "/api/transfers/assets") {
      return { assets: await intents.assets() };
    }
    const transferMatch = /^\/api\/transfers\/([\da-f-]{36})(\/deposit|\/send-asset|\/send-asset\/submit)?$/.exec(url.pathname);
    const transferId = transferMatch?.[1];
    if (transferId) {
      const transfer = transfers.get(config.mode, transferId);
      if (!transfer?.quote.depositAddress) throw new RequestError(404, "transfer_missing", "Transfer not found");
      if (req.method === "POST" && (url.pathname.endsWith("/send-asset") || url.pathname.endsWith("/send-asset/submit"))) {
        if (!req.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "expected_json", "Send a JSON request");
        const body: unknown = await req.json().catch(() => null);
        if (url.pathname.endsWith("/send-asset")) {
          return { id: transferId, ...owner.sendAsset(transfer.quote.transfer ?? {}, Number((body as { chainId?: unknown })?.chainId)) };
        }
        // Debits the venue account in the quote; only to this quote's deposit address.
        return { id: transferId, ...await owner.submit(body, {
          expectedSigner: transfer.quote.venueAddress,
          allowDestination: d => d === transfer.quote.depositAddress?.toLowerCase(),
          expectedTransfer: transfer.quote.transfer as Record<string, unknown> | null,
          deadline: transfer.quote.deadline,
        }) };
      }
      if (req.method === "POST" && transferMatch?.[2] === "/deposit") {
        if (!req.headers.get("content-type")?.startsWith("application/json")) {
          throw new RequestError(415, "expected_json", "Send a JSON request");
        }
        const body: unknown = await req.json().catch(() => null);
        const txHash = typeof (body as { txHash?: unknown })?.txHash === "string" ? (body as { txHash: string }).txHash : "";
        if (!/^0x[\da-fA-F]{64}$/.test(txHash)) throw new RequestError(400, "invalid_tx", "Provide the source txHash (0x + 64 hex)");
        return { id: transferId, ...await intents.submitDeposit(transfer.quote.depositAddress, txHash) };
      }
      if (req.method === "GET" && !transferMatch?.[2]) {
        const status = await intents.status(transfer.quote.depositAddress);
        // Provider SUCCESS isn't proof of credit: for inbound funding, also report the recipient's venue balances.
        const recipient = transfer.quote.direction === "fund" && config.mode === "mainnet"
          ? await Promise.all([venue.account(transfer.quote.recipient), exchange.usableUsdc(transfer.quote.recipient)]).then(
            ([a, m]) => ({ address: a.address, withdrawableUsdc: a.withdrawableUsdc, spotUsdc: a.spotUsdc,
              accountMode: m.mode, usableUsdc: m.usableUsdc, observedAt: a.observedAt }),
            () => null)
          : null;
        return { id: transferId, mode: config.mode, ...transfer, ...status, recipientAccount: recipient };
      }
    }
    throw new RequestError(404, "not_found", "Route not found");
  }

  return {
    async fetch(req: Request) {
      const url = new URL(req.url);
      const ops = await serveOps(url);
      if (ops) return ops;
      const origin = req.headers.get("origin");
      const headers = new Headers({ "Cache-Control": "no-store" });
      if (origin && origin !== url.origin && origin !== config.appOrigin) {
        return Response.json({ error: "origin_rejected", message: "Origin is not allowed" }, { status: 403, headers });
      }
      if (origin && origin === config.appOrigin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Credentials", "true");
      }
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (req.method === "GET" && url.pathname === "/api/events") {
        headers.set("Content-Type", "text/event-stream");
        headers.set("Connection", "keep-alive");
        try {
          return new Response(hedges.events(req, url), { headers });
        } catch (error) {
          headers.delete("Content-Type"); headers.delete("Connection");
          if (error instanceof RequestError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers });
          throw error;
        }
      }
      try {
        if (url.pathname.startsWith("/api/session")) {
          if (req.method === "GET" && url.pathname === "/api/session") {
            return Response.json({ addresses: [...sessions.addresses(req)] }, { headers });
          }
          if (req.method === "POST" && ["/api/session/challenge", "/api/session/verify", "/api/session/signout"].includes(url.pathname)) {
            if (url.pathname === "/api/session/signout") {
              const out = sessions.signOut(req);
              headers.append("Set-Cookie", out.setCookie);
              return Response.json(out.body, { headers });
            }
            if (!req.headers.get("content-type")?.startsWith("application/json")) {
              throw new RequestError(415, "expected_json", "Send a JSON request");
            }
            const body: unknown = await req.json().catch(() => null);
            if (url.pathname === "/api/session/challenge") return Response.json(sessions.challenge(body), { headers });
            const out = await sessions.verify(body);
            headers.append("Set-Cookie", out.setCookie);
            return Response.json(out.body, { headers });
          }
        }
        return Response.json(await route(req, url), { headers });
      } catch (error) {
        if (error instanceof RequestError) {
          return Response.json({ error: error.code, message: error.message }, { status: error.status, headers });
        }
        console.error("Baghedge API unexpected error", error);
        return Response.json({ error: "internal_error", message: "Request could not be completed" }, { status: 500, headers });
      }
    },
    worker,
    close() { worker?.stop(); transfers.close(); db.close(); },
  };
}

if (import.meta.main) {
  const mode = process.env.APP_MODE || "testnet";
  if (mode !== "mainnet" && mode !== "testnet") throw new Error("APP_MODE must be testnet or mainnet");
  const api = createApi({
    mode,
    appOrigin: process.env.APP_ORIGIN || undefined,
    dbPath: process.env.BAGHEDGE_DB_PATH || "data/baghedge.sqlite",
    solanaRpc: process.env.SOLANA_RPC_URL ||
      (mode === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com"),
    intentsUrl: process.env.INTENTS_BASE_URL || undefined,
    intentsJwt: process.env.INTENTS_JWT || undefined,
    signer: await signerFromEnv(mode),
    worker: process.env.WORKER !== "0",
  });
  const host = process.env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.APP_ORIGIN?.startsWith("https://")) {
    // Public binds need an HTTPS app origin: session cookies are Secure and challenges are bound to that origin.
    throw new Error(`Refusing to bind ${host} without an https:// APP_ORIGIN.`);
  }
  const server = Bun.serve({
    hostname: host, port: Number(process.env.PORT || 3001), maxRequestBodySize: 8192, fetch: api.fetch,
    // A first per-owner agent lookup runs the guard on OutLayer (~10–30 s); Bun's 10 s default cut it off.
    idleTimeout: 120,
  });
  console.log(`Baghedge API (${mode}) listening at ${server.url}`);
}

/**
 * HEDGE_SIGNER=fallback: a server-held agent key (FALLBACK_AGENT_PRIVATE_KEY). Labeled demo signer; refused on
 * mainnet unless ALLOW_MAINNET_FALLBACK=labeled-demo. HEDGE_SIGNER=guard: the OutLayer guard via server/guard.ts
 * (Codex), configured by OUTLAYER_CALLER, OUTLAYER_NEAR_PRIVATE_KEY, OUTLAYER_WASM_URL, OUTLAYER_WASM_SHA256,
 * OUTLAYER_AGENT_ADDRESS and optional OUTLAYER_NEAR_RPC_URL.
 */
// A function-scoped holder (not a module `let`): startup runs signerFromEnv before later top-level
// declarations initialize, so a `let` here would be in its temporal dead zone.
function dbForAgents(): ReturnType<typeof openDb> {
  const holder = dbForAgents as unknown as { db?: ReturnType<typeof openDb> };
  holder.db ??= openDb(process.env.BAGHEDGE_DB_PATH || "data/baghedge.sqlite");
  return holder.db;
}

/**
 * Durable owner → agent mapping for a multi-owner guard, keyed by network, build and executor (a new build or
 * executor yields new agents). Concurrent misses for an owner share one guard call; misses are rate-limited.
 */
export function multiOwnerAgentCache(db: ReturnType<typeof openDb>, network: string, buildHash: string, caller: string) {
  db.raw.run(`CREATE TABLE IF NOT EXISTS guard_agents (network TEXT NOT NULL, build_hash TEXT NOT NULL, caller TEXT NOT NULL,
    owner TEXT NOT NULL, agent TEXT NOT NULL, attestation_tx TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY (network, build_hash, caller, owner))`);
  const inflight = new Map<string, Promise<{ agentAddress: Hex; attestationTxHash?: string | null }>>();
  const lastMiss = new Map<string, number>();
  const MISS_INTERVAL_MS = 60_000;
  // Global cap on paid discoveries (new owners) per rolling hour, so many sessions can't drain the executor.
  const perHour = Math.max(1, Number(process.env.OUTLAYER_DISCOVERY_PER_HOUR) || 30);
  const recent: number[] = [];
  return {
    async get(owner: Hex, discover: boolean, lookup: (o: Hex) => Promise<{ agentAddress: Hex; attestationTxHash?: string | null }>) {
      const o = owner.toLowerCase() as Hex;
      const row = db.raw.query("SELECT agent, attestation_tx FROM guard_agents WHERE network=$n AND build_hash=$b AND caller=$c AND owner=$o")
        .get({ n: network, b: buildHash, c: caller, o }) as { agent: string; attestation_tx: string | null } | null;
      if (row) return { agentAddress: row.agent as Hex, attestationTxHash: row.attestation_tx };
      if (!discover) return null;
      const pending = inflight.get(o);
      if (pending) return pending;
      if (Date.now() - (lastMiss.get(o) ?? 0) < MISS_INTERVAL_MS) throw new RequestError(429, "agent_lookup_rate_limited", "Try again in a minute");
      while (recent.length && Date.now() - recent[0]! > 3_600_000) recent.shift();
      if (recent.length >= perHour) throw new RequestError(429, "agent_lookup_busy", "Too many new accounts right now; try again later");
      recent.push(Date.now());
      lastMiss.set(o, Date.now());
      const p = lookup(o).then(result => {
        db.raw.query("INSERT OR REPLACE INTO guard_agents VALUES ($n, $b, $c, $o, $a, $t, $now)")
          .run({ n: network, b: buildHash, c: caller, o, a: result.agentAddress.toLowerCase(), t: result.attestationTxHash ?? null, now: Date.now() });
        return result;
      }).finally(() => inflight.delete(o));
      inflight.set(o, p);
      return p;
    },
  };
}

async function signerFromEnv(mode: "testnet" | "mainnet"): Promise<AppConfig["signer"]> {
  const kind = process.env.HEDGE_SIGNER;
  if (!kind) return undefined;
  if (kind === "fallback") {
    const key = process.env.FALLBACK_AGENT_PRIVATE_KEY;
    if (!key || !/^0x[\da-f]{64}$/i.test(key)) throw new Error("FALLBACK_AGENT_PRIVATE_KEY must be a 32-byte hex key");
    if (mode === "mainnet" && process.env.ALLOW_MAINNET_FALLBACK !== "labeled-demo") {
      throw new Error("The fallback signer is testnet-only unless ALLOW_MAINNET_FALLBACK=labeled-demo");
    }
    const signer = verifiedSigner(fallbackSigner(key as Hex, mode), mode);
    // A fixed, recognizable non-zero label: the fallback has no attested build.
    const buildHash = keccak256(stringToHex("baghedge-fallback-agent-unattested"));
    console.warn(`Hedge signer: FALLBACK agent ${signer.address} (${mode}). Not an attested guard.`);
    return { kind: "fallback", agentAddress: signer.address, buildHash, signerFor: () => signer };
  }
  if (kind === "guard" && process.env.OUTLAYER_MULTI_OWNER === "1") {
    // Multi-owner guard (option B): one attested build, an agent derived per Hedge owner inside the guard.
    // server/guard.ts must export agentFor/createGuardSignerFor; until it does, refuse to start in this mode.
    const g = guardModule as unknown as {
      multiOwnerExecutorFromEnv?(mode: string): { buildHash: Hex };
      agentFor?(executor: unknown, owner: Hex): Promise<{ agentAddress: Hex; attestationTxHash?: string | null }>;
      createGuardSignerFor?(ctx: Record<string, unknown>, executor: unknown): HedgeSigner;
    };
    if (!g.multiOwnerExecutorFromEnv || !g.agentFor || !g.createGuardSignerFor) {
      throw new Error("OUTLAYER_MULTI_OWNER=1 needs the multi-owner guard adapter in server/guard.ts");
    }
    const executor = g.multiOwnerExecutorFromEnv(mode);
    const agents = multiOwnerAgentCache(dbForAgents(), mode, executor.buildHash, process.env.OUTLAYER_CALLER ?? "");
    const agentFor = (owner: Hex, opts: { discover: boolean }) => agents.get(owner, opts.discover, o => g.agentFor!(executor, o));
    console.log(`Hedge signer: OutLayer MULTI-OWNER guard build ${executor.buildHash} (${mode}).`);
    return {
      kind: "guard", agentAddress: null, buildHash: executor.buildHash.toLowerCase() as Hex, agentFor,
      signerFor: (rule, context) => verifiedSigner(g.createGuardSignerFor!({
        policy: rule.policy, ownerSig: rule.ownerSig as Hex, chainId: rule.chainId,
        entryUntilMs: context.entryUntilMs, cancelRefs: context.cancelRefs, orderRef: context.orderRef,
      }, executor), mode),
    };
  }
  if (kind === "guard") {
    // Agent address and build hash come from the same pinned executor config the guard uses.
    const executor = outLayerExecutorFromEnv(mode);
    console.log(`Hedge signer: OutLayer guard agent ${executor.agent} build ${executor.buildHash} (${mode}).`);
    return {
      kind: "guard", agentAddress: executor.agent.toLowerCase() as Hex, buildHash: executor.buildHash.toLowerCase() as Hex,
      // Public: the Hedge owner compiled into this guard build (refuse other owners before they sign or fund).
      pinnedOwner: isEvmAddress(process.env.OUTLAYER_PINNED_OWNER) ? process.env.OUTLAYER_PINNED_OWNER.toLowerCase() as Hex : undefined,
      signerFor: (rule, context) => {
        // orderRef lets the guard check the cloid against the signed rule (codex/guard-cloids).
        const guardContext = {
          policy: rule.policy, ownerSig: rule.ownerSig as Hex, chainId: rule.chainId,
          entryUntilMs: context.entryUntilMs, cancelRefs: context.cancelRefs, orderRef: context.orderRef,
        };
        return verifiedSigner(createGuardSigner(guardContext, executor), mode);
      },
    };
  }
  throw new Error("HEDGE_SIGNER must be fallback or guard");
}
