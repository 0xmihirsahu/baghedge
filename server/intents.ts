import { fromUnits, isEvmAddress, toUnits } from "../shared/amounts";
import { isRecord, isUnits, providerJson, RequestError } from "./http";

export const BASE_USDC = {
  id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  decimals: 6,
  contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export const PERPS_USDC = {
  id: "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
  decimals: 8,
  token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
};

export const INTENTS_URL = "https://1click.chaindefuser.com";

export type QuoteInput = {
  direction: "fund" | "withdraw";
  role: "trade" | "hedge";
  baseAddress: string;
  venueAddress: string;
  amount: string;
  dry: boolean;
};

export type FundingQuote = Awaited<ReturnType<ReturnType<typeof createIntents>["quote"]>>;

export function parseQuoteInput(input: unknown): QuoteInput {
  if (
    !isRecord(input) ||
    (input.direction !== "fund" && input.direction !== "withdraw") ||
    (input.role !== "trade" && input.role !== "hedge") ||
    !isEvmAddress(input.baseAddress) ||
    !isEvmAddress(input.venueAddress) ||
    typeof input.amount !== "string" ||
    (input.dry !== undefined && typeof input.dry !== "boolean")
  ) throw new RequestError(400, "invalid_quote", "Provide direction, role, both wallet addresses, and a decimal amount");

  return {
    direction: input.direction,
    role: input.role,
    baseAddress: input.baseAddress.toLowerCase(),
    venueAddress: input.venueAddress.toLowerCase(),
    amount: input.amount,
    dry: input.dry !== false,
  };
}

export function createIntents(baseUrl = INTENTS_URL, jwt?: string, request = fetch) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  let tokensCheckedUntil = 0;
  let checking: Promise<void> | undefined;

  async function checkTokens() {
    if (Date.now() < tokensCheckedUntil) return;
    checking ??= (async () => {
      const tokens = await providerJson(new URL("/v0/tokens", baseUrl), { headers }, "NEAR Intents", request);
      if (!Array.isArray(tokens) || ![BASE_USDC, PERPS_USDC].every(asset =>
        tokens.some(token => isRecord(token) && token.assetId === asset.id && token.decimals === asset.decimals),
      )) throw new RequestError(502, "route_assets_missing", "NEAR Intents did not list the expected USDC assets");
      tokensCheckedUntil = Date.now() + 5 * 60_000;
    })().finally(() => { checking = undefined; });
    await checking;
  }

  return {
    async quote(input: QuoteInput) {
      const funding = input.direction === "fund";
      const origin = funding ? BASE_USDC : PERPS_USDC;
      const destination = funding ? PERPS_USDC : BASE_USDC;
      const recipient = funding ? input.venueAddress : input.baseAddress;
      const refundTo = funding ? input.baseAddress : input.venueAddress;

      let amount: bigint;
      try {
        amount = toUnits(input.amount, origin.decimals);
      } catch {
        throw new RequestError(400, "invalid_amount", "Amount must be a decimal within the source asset precision");
      }
      if (amount <= 0n) throw new RequestError(400, "invalid_amount", "Amount must be positive");
      await checkTokens();

      const deadline = new Date(Date.now() + 20 * 60_000).toISOString();
      const payload = {
        dry: input.dry,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: origin.id,
        destinationAsset: destination.id,
        amount: amount.toString(),
        depositType: "ORIGIN_CHAIN",
        recipient,
        recipientType: "DESTINATION_CHAIN",
        refundTo,
        refundType: "ORIGIN_CHAIN",
        deadline,
      };
      const result = await providerJson(new URL("/v0/quote", baseUrl), {
        method: "POST", headers, body: JSON.stringify(payload),
      }, "NEAR Intents", request);
      const quote = isRecord(result) ? result.quote : undefined;
      const echoed = isRecord(result) ? result.quoteRequest : undefined;
      if (!isRecord(quote) || !isRecord(echoed) ||
        !Object.entries(payload).every(([key, value]) => {
          const actual = echoed[key];
          if (key === "recipient" || key === "refundTo") {
            return isEvmAddress(actual) && actual.toLowerCase() === value;
          }
          if (key === "deadline") return typeof actual === "string" && Date.parse(actual) === Date.parse(deadline);
          return actual === value;
        }) ||
        quote.amountIn !== payload.amount ||
        !isUnits(quote.amountOut) || !isUnits(quote.minAmountOut) ||
        BigInt(quote.minAmountOut) <= 0n ||
        BigInt(quote.minAmountOut) > BigInt(quote.amountOut)) {
        throw new RequestError(502, "invalid_provider_quote", "NEAR Intents returned an unexpected quote");
      }
      const depositDeadline = input.dry ? null : quote.deadline;
      if (Date.parse(deadline) <= Date.now() || (!input.dry &&
        (typeof depositDeadline !== "string" || !(Date.parse(depositDeadline) > Date.now())))) {
        throw new RequestError(502, "invalid_provider_quote", "NEAR Intents returned an invalid quote deadline");
      }
      const reviewDeadline = typeof depositDeadline === "string" && Date.parse(depositDeadline) < Date.parse(deadline)
        ? depositDeadline : deadline;
      const depositAddress = input.dry ? null : quote.depositAddress;
      if (!input.dry && !isEvmAddress(depositAddress)) {
        throw new RequestError(502, "invalid_provider_quote", "NEAR Intents did not return a usable deposit address");
      }
      const transfer = isEvmAddress(depositAddress)
        ? funding
          ? { type: "baseErc20Transfer" as const, chainId: 8453, contract: BASE_USDC.contract,
              from: input.baseAddress, to: depositAddress, amount: amount.toString() }
          : { type: "hypercoreSendAsset" as const, hyperliquidChain: "Mainnet",
              from: input.venueAddress, destination: depositAddress, sourceDex: "", destinationDex: "",
              fromSubAccount: "", token: PERPS_USDC.token, amount: fromUnits(amount, origin.decimals) }
        : null;

      return {
        ...input, originAsset: origin.id, destinationAsset: destination.id, recipient, refundTo,
        amountIn: payload.amount, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut,
        originDecimals: origin.decimals, destinationDecimals: destination.decimals,
        deadline: reviewDeadline, depositDeadline: typeof depositDeadline === "string" ? depositDeadline : null,
        depositAddress: isEvmAddress(depositAddress) ? depositAddress : null, transfer,
        correlationId: isRecord(result) && typeof result.correlationId === "string" ? result.correlationId : null,
        timeEstimate: typeof quote.timeEstimate === "number" ? quote.timeEstimate : null,
      };
    },

    /** Optional speed-up: tells 1Click which source transaction paid the deposit address. */
    async submitDeposit(depositAddress: string, txHash: string) {
      const result = await providerJson(new URL("/v0/deposit/submit", baseUrl), {
        method: "POST", headers, body: JSON.stringify({ depositAddress, txHash }),
      }, "NEAR Intents", request);
      return isRecord(result) && typeof result.status === "string" ? { status: result.status } : { status: "SUBMITTED" };
    },

    async status(depositAddress: string) {
      const url = new URL("/v0/status", baseUrl);
      url.searchParams.set("depositAddress", depositAddress);
      const result = await providerJson(url, { headers }, "NEAR Intents", request);
      if (!isRecord(result) || typeof result.status !== "string") {
        throw new RequestError(502, "invalid_provider_status", "NEAR Intents did not return a transfer status");
      }
      return {
        status: result.status,
        swapDetails: isRecord(result.swapDetails) ? result.swapDetails : null,
      };
    },
  };
}
