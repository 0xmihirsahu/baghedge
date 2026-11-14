import { keccak256, stringToHex } from "viem";
import { isEvmAddress, isSolanaAddress } from "../shared/amounts";
import { previewHedge } from "./preview";
import { RequestError } from "./http";
import { createIntents, parseQuoteInput } from "./intents";
import { openTransfers } from "./transfers";
import { createVenue, readSolBalance } from "./venue";
import { openDb } from "./db";
import { serveOps } from "./ops/serve";
import { createSessions } from "./session";
import { createOwnerActions } from "./owner";
import { createGuardSigner, outLayerExecutorFromEnv } from "./guard";
import { createExchange, fallbackSigner, verifiedSigner, type HedgeSigner, type Hex } from "./exchange";
import { createHedgeRoutes, SESSION_FOR, type SignerConfig } from "./hedges";
import { createWorker, type SignContext } from "./worker";
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
    onArmed: id => { void worker?.tickRule(id).catch(error => console.error("hedge tick failed", error)); },
  });
  if (worker && config.worker) worker.start();

  async function route(req: Request, url: URL) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return {
        mode: config.mode, executableQuotesEnabled: config.mode === "mainnet",
        hedgeSigner: config.signer
          ? { kind: config.signer.kind, agentAddress: config.signer.agentAddress, buildHash: config.signer.buildHash }
          : null,
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
      const [tradeAccount, hedgeAccount] = await Promise.all([
        venue.account(trade.toLowerCase()),
        hedge ? venue.account(hedge.toLowerCase()) : null,
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
          ? await venue.account(transfer.quote.recipient).then(
            a => ({ address: a.address, withdrawableUsdc: a.withdrawableUsdc, spotUsdc: a.spotUsdc, observedAt: a.observedAt }),
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
        const result = await route(req, url);
        if (result && typeof result === "object" && SESSION_FOR in result) {
          const { [SESSION_FOR]: owner, ...body } = result as Record<string, unknown>;
          if (typeof owner === "string") headers.append("Set-Cookie", sessions.issue(owner));
          return Response.json(body, { headers });
        }
        return Response.json(result, { headers });
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
  });
  console.log(`Baghedge API (${mode}) listening at ${server.url}`);
}

/**
 * HEDGE_SIGNER=fallback: a server-held agent key (FALLBACK_AGENT_PRIVATE_KEY). Labeled demo signer; refused on
 * mainnet unless ALLOW_MAINNET_FALLBACK=labeled-demo. HEDGE_SIGNER=guard: the OutLayer guard via server/guard.ts
 * (Codex), configured by OUTLAYER_CALLER, OUTLAYER_NEAR_PRIVATE_KEY, OUTLAYER_WASM_URL, OUTLAYER_WASM_SHA256,
 * OUTLAYER_AGENT_ADDRESS and optional OUTLAYER_NEAR_RPC_URL.
 */
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
  if (kind === "guard") {
    // Agent address and build hash come from the same pinned executor config the guard uses.
    const executor = outLayerExecutorFromEnv(mode);
    console.log(`Hedge signer: OutLayer guard agent ${executor.agent} build ${executor.buildHash} (${mode}).`);
    return {
      kind: "guard", agentAddress: executor.agent.toLowerCase() as Hex, buildHash: executor.buildHash.toLowerCase() as Hex,
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
