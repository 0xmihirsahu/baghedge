import { isEvmAddress, isSolanaAddress } from "../shared/amounts";
import { previewHedge } from "./preview";
import { RequestError } from "./http";
import { createIntents, parseQuoteInput } from "./intents";
import { openTransfers } from "./transfers";
import { createVenue, readSolBalance } from "./venue";

type AppConfig = {
  mode: "testnet" | "mainnet";
  appOrigin?: string;
  dbPath: string;
  solanaRpc: string;
  intentsUrl?: string;
  intentsJwt?: string;
};

export function createApi(config: AppConfig, request = fetch) {
  const venue = createVenue(config.mode, request);
  const intents = createIntents(config.intentsUrl, config.intentsJwt, request);
  const transfers = openTransfers(config.dbPath);

  async function route(req: Request, url: URL) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return { mode: config.mode, executableQuotesEnabled: config.mode === "mainnet" };
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
    const transferId = /^\/api\/transfers\/([\da-f-]{36})$/.exec(url.pathname)?.[1];
    if (req.method === "GET" && transferId) {
      const transfer = transfers.get(config.mode, transferId);
      if (!transfer?.quote.depositAddress) throw new RequestError(404, "transfer_missing", "Transfer not found");
      return {
        id: transferId, mode: config.mode, ...transfer,
        ...await intents.status(transfer.quote.depositAddress),
      };
    }
    throw new RequestError(404, "not_found", "Route not found");
  }

  return {
    async fetch(req: Request) {
      const url = new URL(req.url);
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
      }
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      try {
        return Response.json(await route(req, url), { headers });
      } catch (error) {
        if (error instanceof RequestError) {
          return Response.json({ error: error.code, message: error.message }, { status: error.status, headers });
        }
        console.error("Baghedge API unexpected error", error);
        return Response.json({ error: "internal_error", message: "Request could not be completed" }, { status: 500, headers });
      }
    },
    close: transfers.close,
  };
}

if (import.meta.main) {
  const mode = process.env.APP_MODE ?? "testnet";
  if (mode !== "mainnet" && mode !== "testnet") throw new Error("APP_MODE must be testnet or mainnet");
  const api = createApi({
    mode,
    appOrigin: process.env.APP_ORIGIN,
    dbPath: process.env.BAGHEDGE_DB_PATH ?? "data/baghedge.sqlite",
    solanaRpc: process.env.SOLANA_RPC_URL ??
      (mode === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com"),
    intentsUrl: process.env.INTENTS_BASE_URL,
    intentsJwt: process.env.INTENTS_JWT,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: Number(process.env.PORT ?? 3001), maxRequestBodySize: 8192, fetch: api.fetch,
  });
  console.log(`Baghedge API (${mode}) listening at ${server.url}`);
}
