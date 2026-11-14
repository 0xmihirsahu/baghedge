import { expect, test } from "bun:test";
import { createApi } from "../server/index";
import { BASE_USDC, PERPS_USDC } from "../server/intents";

const baseAddress = "0x" + "1".repeat(40);
const venueAddress = "0x" + "2".repeat(40);
const depositAddress = "0x" + "3".repeat(40);
const quoteInput = { role: "hedge", direction: "fund", amount: "25", baseAddress, venueAddress };

test("funding and withdrawal use source units and keep dry quotes unsigned", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const stub = mockIntents(calls);
  const api = createApi({ mode: "mainnet", dbPath: ":memory:", solanaRpc: "https://solana.invalid" }, stub);
  try {
    const fund = await api.fetch(quoteRequest(quoteInput));
    expect(fund.status).toBe(200);
    expect(await fund.json()).toMatchObject({ id: null, dry: true, amountIn: "25000000", transfer: null });
    expect(calls[0]).toMatchObject({ originAsset: BASE_USDC.id, destinationAsset: PERPS_USDC.id,
      recipient: venueAddress, refundTo: baseAddress, amount: "25000000" });

    const withdraw = await api.fetch(quoteRequest({ ...quoteInput, direction: "withdraw", dry: false }));
    expect(withdraw.status).toBe(200);
    const executable = await withdraw.json();
    expect(executable).toMatchObject({ dry: false, amountIn: "2500000000", depositAddress,
      transfer: { type: "hypercoreSendAsset", destination: depositAddress, from: venueAddress, amount: "25" } });
    expect(Date.parse(executable.depositDeadline)).toBeGreaterThan(Date.parse(executable.deadline));
    expect(calls[1]).toMatchObject({ originAsset: PERPS_USDC.id, destinationAsset: BASE_USDC.id,
      recipient: baseAddress, refundTo: venueAddress, amount: "2500000000" });
    const status = await api.fetch(new Request("http://localhost/api/transfers/" + executable.id));
    expect(await status.json()).toMatchObject({ status: "PROCESSING", quote: { depositAddress } });
  } finally { api.close(); }
});

test("testnet rejects executable funding and account aliasing before any upstream request", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const api = createApi({ mode: "testnet", dbPath: ":memory:", solanaRpc: "https://solana.invalid" }, mockIntents(calls));
  try {
    const quote = await api.fetch(quoteRequest({ ...quoteInput, dry: false }));
    expect(quote.status).toBe(409);
    const aliased = await api.fetch(new Request(`http://localhost/api/accounts?trade=${venueAddress}&hedge=${venueAddress}`));
    expect(aliased.status).toBe(400);
    expect(calls).toHaveLength(0);
  } finally { api.close(); }
});

test("hedge preview sizes against liquid SOL and rejects a trigger already crossed", async () => {
  const wallet = "11111111111111111111111111111111";
  const stub = Object.assign(async (request: string | URL | Request, options?: RequestInit) => {
    const payload = JSON.parse(String(options?.body));
    if (String(request) === "https://solana.invalid") {
      expect(payload.params[0]).toBe(wallet);
      return Response.json({ result: { context: { slot: 10 }, value: 5_123_000_000 } });
    }
    if (payload.type === "metaAndAssetCtxs") {
      return Response.json([
        { universe: [{ name: "SOL", szDecimals: 2, maxLeverage: 20 }] },
        [{ markPx: "145.12345", funding: "0.00001" }],
      ]);
    }
    expect(payload.user).toBe(venueAddress);
    if (payload.type === "clearinghouseState") return Response.json({ withdrawable: "25", assetPositions: [] });
    if (payload.type === "frontendOpenOrders") return Response.json([]);
    throw new Error("Unexpected provider request");
  }, { preconnect: fetch.preconnect });
  const api = createApi({ mode: "testnet", dbPath: ":memory:", solanaRpc: "https://solana.invalid" }, stub);
  const payload = {
    tradeAddress: baseAddress, hedgeAddress: venueAddress, solanaAddress: wallet,
    maxSol: "6", entryMark: "140", entryFloor: "137.2", recoveryMark: "161", exitCeiling: "165",
  };
  function preview(body: object) {
    return api.fetch(new Request("http://localhost/api/hedges/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  }
  try {
    const response = await preview(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eligibleSol: "5.12", market: { asset: 0 }, wallet: { slot: 10 } });
    const crossed = await preview({ ...payload, entryMark: "146" });
    expect(crossed.status).toBe(409);
    expect(await crossed.json()).toMatchObject({ error: "entry_already_crossed" });
  } finally { api.close(); }
});

function quoteRequest(body: object) {
  return new Request("http://localhost/api/transfers/quote", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function mockIntents(calls: Array<Record<string, unknown>>): typeof fetch {
  return Object.assign(async (request: string | URL | Request, options?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : request);
    if (url.pathname === "/v0/tokens") {
      // Shape of the real /v0/tokens response.
      return Response.json([
        { assetId: BASE_USDC.id, decimals: BASE_USDC.decimals, blockchain: "base", symbol: "USDC", contractAddress: BASE_USDC.contract.toLowerCase() },
        { assetId: PERPS_USDC.id, decimals: PERPS_USDC.decimals, blockchain: "hypercore", symbol: "USDC" },
        { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL" },
      ]);
    }
    if (url.pathname === "/v0/quote" && typeof options?.body === "string") {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      return Response.json({ quoteRequest: payload, quote: {
        amountIn: payload.amount, amountOut: "123", minAmountOut: "120",
        deadline: new Date(Date.parse(payload.deadline) + 3 * 86_400_000).toISOString(),
        ...(payload.dry ? {} : { depositAddress }),
      } }, { status: 201 });
    }
    if (url.pathname === "/v0/status" && url.searchParams.get("depositAddress") === depositAddress) {
      return Response.json({ status: "PROCESSING" });
    }
    throw new Error("Unexpected provider request");
  }, { preconnect: fetch.preconnect });
}
