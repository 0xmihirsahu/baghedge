import { fromUnits, isEvmAddress, isSolanaAddress, toUnits } from "../shared/amounts";
import { buildHedgeOrder } from "../shared/orders";
import type { HedgeRule } from "../shared/hedge";
import { isRecord, RequestError } from "./http";
import type { createVenue, readSolBalance } from "./venue";

export async function previewHedge(
  input: unknown,
  venue: ReturnType<typeof createVenue>,
  readWallet: (address: string) => ReturnType<typeof readSolBalance>,
) {
  if (!isRecord(input) || !isEvmAddress(input.tradeAddress) || !isEvmAddress(input.hedgeAddress) ||
    !isSolanaAddress(input.solanaAddress) || typeof input.maxSol !== "string" ||
    typeof input.entryMark !== "string" || typeof input.entryFloor !== "string" ||
    typeof input.recoveryMark !== "string" || typeof input.exitCeiling !== "string") {
    throw new RequestError(400, "invalid_preview", "Provide separate accounts, a Solana wallet, size, and entry and exit prices");
  }
  const tradeAddress = input.tradeAddress.toLowerCase();
  const hedgeAddress = input.hedgeAddress.toLowerCase();
  if (tradeAddress === hedgeAddress) {
    throw new RequestError(400, "account_alias", "Trade and Hedge need different Hyperliquid accounts");
  }
  const [markets, account, wallet] = await Promise.all([
    venue.markets(), venue.account(hedgeAddress), readWallet(input.solanaAddress),
  ]);
  const market = markets.find(item => item.coin === "SOL");
  if (!market) throw new RequestError(502, "sol_market_missing", "Hyperliquid did not return the SOL market");
  if (account.orders.length || account.positions.some(position => /[1-9]/.test(position.size))) {
    throw new RequestError(409, "hedge_account_busy", "Use a Hedge account with no perp positions or open orders");
  }

  const priceDecimals = 6 - market.sizeDecimals;
  let prices: Pick<HedgeRule, "entryMark" | "entryFloor" | "recoveryMark" | "exitCeiling">;
  let maxLots: bigint;
  try {
    maxLots = toUnits(input.maxSol, market.sizeDecimals);
    prices = {
      entryMark: toUnits(input.entryMark, priceDecimals),
      entryFloor: toUnits(input.entryFloor, priceDecimals),
      recoveryMark: toUnits(input.recoveryMark, priceDecimals),
      exitCeiling: toUnits(input.exitCeiling, priceDecimals),
    };
  } catch {
    throw new RequestError(400, "invalid_precision", "Size or price exceeds the SOL market precision");
  }
  const walletLots = BigInt(wallet.lamports) / 10n ** BigInt(9 - market.sizeDecimals);
  const eligibleLots = walletLots < maxLots ? walletLots : maxLots;
  if (eligibleLots <= 0n) throw new RequestError(409, "no_eligible_sol", "No liquid SOL at the requested order precision");
  if (prices.entryFloor <= 0n || prices.entryFloor > prices.entryMark ||
    prices.recoveryMark <= prices.entryMark || prices.exitCeiling < prices.recoveryMark) {
    throw new RequestError(400, "invalid_price_band", "Entry floor, entry mark, recovery mark and exit ceiling must be in order");
  }
  // The feed can carry more decimal places than a venue order price accepts.
  const markParts = market.markPrice.split(".");
  const compareDecimals = Math.max(priceDecimals, markParts[1]?.length ?? 0);
  if (toUnits(market.markPrice, compareDecimals) <= toUnits(input.entryMark, compareDecimals)) {
    throw new RequestError(409, "entry_already_crossed", "Current mark must be above the entry trigger");
  }
  try {
    buildHedgeOrder(market, priceDecimals, { ...prices, maxLots, endTime: 1, entryWindowMs: 1 }, {
      kind: "entry", lots: eligibleLots, limit: prices.entryFloor, reduceOnly: false,
    }, { order: "0x" + "1".repeat(32), recovery: "0x" + "2".repeat(32) });
  } catch {
    throw new RequestError(400, "invalid_order_price", "Entry or recovery order price does not match venue tick rules");
  }
  return {
    tradeAddress, hedgeAddress, wallet, market, maxSol: fromUnits(maxLots, market.sizeDecimals),
    eligibleSol: fromUnits(eligibleLots, market.sizeDecimals),
    withdrawableUsdc: account.withdrawableUsdc, entryMark: input.entryMark, entryFloor: input.entryFloor,
    recoveryMark: input.recoveryMark, exitCeiling: input.exitCeiling,
  };
}
