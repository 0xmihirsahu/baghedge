import { isDecimal, isRecord, providerJson, RequestError } from "./http";

export const HYPERLIQUID_URL = {
  mainnet: "https://api.hyperliquid.xyz",
  testnet: "https://api.hyperliquid-testnet.xyz",
};

export function createVenue(network: keyof typeof HYPERLIQUID_URL, request = fetch) {
  async function info(payload: object) {
    return providerJson(new URL("/info", HYPERLIQUID_URL[network]), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, "Hyperliquid", request);
  }

  return {
    async markets() {
      const result = await info({ type: "metaAndAssetCtxs" });
      const universe = Array.isArray(result) && isRecord(result[0]) ? result[0].universe : null;
      const contexts: unknown = Array.isArray(result) ? result[1] : null;
      if (!Array.isArray(universe) || !Array.isArray(contexts) || contexts.length !== universe.length) {
        throw new RequestError(502, "invalid_market_data", "Hyperliquid returned mismatched market metadata");
      }
      return universe.flatMap((market: unknown, asset) => {
        if (isRecord(market) && market.isDelisted === true) return [];
        const ctx: unknown = contexts[asset];
        if (!isRecord(market) || typeof market.name !== "string" ||
          typeof market.szDecimals !== "number" || !Number.isInteger(market.szDecimals) ||
          market.szDecimals < 0 || market.szDecimals > 6 ||
          typeof market.maxLeverage !== "number" || market.maxLeverage < 1 ||
          !isRecord(ctx) || typeof ctx.markPx !== "string" || !/^\d{1,24}(\.\d{1,24})?$/.test(ctx.markPx) ||
          !/[1-9]/.test(ctx.markPx) || !isDecimal(ctx.funding)) {
          throw new RequestError(502, "invalid_market_data", "Hyperliquid returned incomplete market data");
        }
        return [{
          asset, coin: market.name, sizeDecimals: market.szDecimals,
          maxLeverage: market.maxLeverage, markPrice: ctx.markPx, fundingRate: ctx.funding,
        }];
      });
    },

    async account(address: string) {
      const [state, orders, spot] = await Promise.all([
        info({ type: "clearinghouseState", user: address }),
        info({ type: "frontendOpenOrders", user: address }),
        // Informational; a failed spot read reports spotUsdc: null rather than failing the account read.
        info({ type: "spotClearinghouseState", user: address }).catch(() => null),
      ]);
      if (!isRecord(state) || !isDecimal(state.withdrawable) ||
        !Array.isArray(state.assetPositions) || !Array.isArray(orders)) {
        throw new RequestError(502, "invalid_account_data", "Hyperliquid returned incomplete account data");
      }
      const positions = state.assetPositions.map((entry: unknown) => {
        const position = isRecord(entry) ? entry.position : undefined;
        if (!isRecord(position) || typeof position.coin !== "string" || !isDecimal(position.szi)) {
          throw new RequestError(502, "invalid_account_data", "Hyperliquid returned an invalid position");
        }
        return {
          coin: position.coin, size: position.szi,
          entryPrice: isDecimal(position.entryPx) ? position.entryPx : null,
          liquidationPrice: isDecimal(position.liquidationPx) ? position.liquidationPx : null,
          unrealizedPnl: isDecimal(position.unrealizedPnl) ? position.unrealizedPnl : null,
        };
      });
      // Unified accounts keep USDC in the spot balance and use it as perps collateral, so perps
      // `withdrawable` alone can read 0 while margin is available. Report both; don't add them blindly.
      const spotBalances = isRecord(spot) && Array.isArray(spot.balances) ? spot.balances : null;
      const usdc = spotBalances?.find((b: unknown) => isRecord(b) && b.coin === "USDC");
      return {
        address, withdrawableUsdc: state.withdrawable,
        spotUsdc: spotBalances === null ? null : {
          total: isRecord(usdc) && isDecimal(usdc.total) ? usdc.total : "0",
          hold: isRecord(usdc) && isDecimal(usdc.hold) ? usdc.hold : "0",
        },
        positions, orders, observedAt: Date.now(),
      };
    },
  };
}

export async function readSolBalance(rpcUrl: string, address: string, request = fetch) {
  const result = await providerJson(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }],
    }),
  }, "Solana RPC", request);
  const balance = isRecord(result) ? result.result : undefined;
  if (!isRecord(balance) || !isRecord(balance.context) || typeof balance.context.slot !== "number" ||
    !Number.isSafeInteger(balance.context.slot) || typeof balance.value !== "number" ||
    !Number.isSafeInteger(balance.value) || balance.value < 0) {
    throw new RequestError(502, "invalid_wallet_data", "Solana RPC did not return a usable balance");
  }
  return {
    address, scope: "liquid-sol" as const, lamports: String(balance.value),
    slot: balance.context.slot, commitment: "confirmed", observedAt: Date.now(),
  };
}
