import { encodeFunctionData, erc20Abi } from "viem";
import { fromUnits, isEvmAddress, isSolanaAddress, toUnits } from "../shared/amounts";
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
  /** The wallet on the external chain: the funding source (fund) or the payout recipient (withdraw). */
  baseAddress: string;
  venueAddress: string;
  amount: string;
  dry: boolean;
  /** 1Click asset id on the external side. Defaults to Base USDC. Any token from GET /api/transfers/assets. */
  externalAsset: string;
};

export type IntentsToken = { assetId: string; decimals: number; blockchain: string; symbol: string; contractAddress?: string; price?: number };

// EVM chains 1Click lists, with chain ids for wallet transactions.
const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, bsc: 56, avax: 43114, gnosis: 100, bera: 80094, scroll: 534352,
};

export type FundingQuote = Awaited<ReturnType<ReturnType<typeof createIntents>["quote"]>>;

export function parseQuoteInput(input: unknown): QuoteInput {
  if (
    !isRecord(input) ||
    (input.direction !== "fund" && input.direction !== "withdraw") ||
    (input.role !== "trade" && input.role !== "hedge") ||
    typeof input.baseAddress !== "string" || !/^[\w.:-]{2,128}$/.test(input.baseAddress) ||
    !isEvmAddress(input.venueAddress) ||
    typeof input.amount !== "string" ||
    (input.dry !== undefined && typeof input.dry !== "boolean") ||
    (input.externalAsset !== undefined && (typeof input.externalAsset !== "string" || !/^[\w.:-]{3,200}$/.test(input.externalAsset)))
  ) throw new RequestError(400, "invalid_quote", "Provide direction, role, both wallet addresses, and a decimal amount");

  return {
    direction: input.direction,
    role: input.role,
    baseAddress: input.baseAddress,
    venueAddress: input.venueAddress.toLowerCase(),
    amount: input.amount,
    dry: input.dry !== false,
    externalAsset: (input.externalAsset as string | undefined) ?? BASE_USDC.id,
  };
}

/** Validates and normalizes an external-chain address for the token's chain (1Click re-validates). */
function externalAddress(token: IntentsToken, address: string) {
  if (token.blockchain in EVM_CHAIN_IDS || /^0x[\da-fA-F]{40}$/.test(address) && !["sol", "near", "btc"].includes(token.blockchain)) {
    if (!isEvmAddress(address)) throw new RequestError(400, "invalid_address", `Provide an EVM address for ${token.blockchain}`);
    return address.toLowerCase();
  }
  if (token.blockchain === "sol" && !isSolanaAddress(address)) throw new RequestError(400, "invalid_address", "Provide a Solana address");
  if (token.blockchain === "near" && !/^[a-z0-9._-]{2,64}$/.test(address)) throw new RequestError(400, "invalid_address", "Provide a NEAR account");
  return address;
}

/** What the source wallet sends to the deposit address, per chain. Base USDC keeps its original shape. */
function fundTransfer(token: IntentsToken, from: string, to: string, amount: bigint, memo: string | null) {
  const chainId = EVM_CHAIN_IDS[token.blockchain];
  if (chainId && token.contractAddress) {
    return { type: "evmErc20Transfer" as const, chainId, contract: token.contractAddress, from, to, amount: amount.toString(),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, amount] }) };
  }
  if (chainId) return { type: "evmNativeTransfer" as const, chainId, from, to, value: amount.toString() };
  if (token.blockchain === "sol") {
    return { type: "solanaTransfer" as const, from, to, mint: token.contractAddress ?? null, amount: amount.toString(), decimals: token.decimals };
  }
  return { type: "deposit" as const, blockchain: token.blockchain, assetId: token.assetId, from, to, amount: amount.toString(), memo };
}

export function createIntents(baseUrl = INTENTS_URL, jwt?: string, request = fetch) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  let tokensCheckedUntil = 0;
  let checking: Promise<void> | undefined;
  let tokenMap = new Map<string, IntentsToken>();

  async function checkTokens() {
    if (Date.now() < tokensCheckedUntil) return;
    checking ??= (async () => {
      const tokens = await providerJson(new URL("/v0/tokens", baseUrl), { headers }, "NEAR Intents", request);
      if (!Array.isArray(tokens) || ![BASE_USDC, PERPS_USDC].every(asset =>
        tokens.some(token => isRecord(token) && token.assetId === asset.id && token.decimals === asset.decimals),
      )) throw new RequestError(502, "route_assets_missing", "NEAR Intents did not list the expected USDC assets");
      tokenMap = new Map(tokens.filter((t: unknown): t is IntentsToken => isRecord(t) && typeof t.assetId === "string" &&
        typeof t.decimals === "number" && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 30 &&
        typeof t.blockchain === "string" && typeof t.symbol === "string").map(t => [t.assetId, t]));
      tokensCheckedUntil = Date.now() + 5 * 60_000;
    })().finally(() => { checking = undefined; });
    await checking;
  }

  return {
    async quote(input: QuoteInput) {
      const funding = input.direction === "fund";
      await checkTokens();
      const token = tokenMap.get(input.externalAsset);
      if (!token || token.blockchain === "hypercore") {
        throw new RequestError(400, "unsupported_asset", "Pick an external asset from GET /api/transfers/assets");
      }
      const external = { id: token.assetId, decimals: token.decimals };
      const externalWallet = externalAddress(token, input.baseAddress);
      const origin = funding ? external : PERPS_USDC;
      const destination = funding ? PERPS_USDC : external;
      const recipient = funding ? input.venueAddress : externalWallet;
      const refundTo = funding ? externalWallet : input.venueAddress;

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
            return typeof actual === "string" && (isEvmAddress(actual) ? actual.toLowerCase() === value : actual === value);
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
      if (!input.dry && (typeof depositAddress !== "string" || !/^[\w.:-]{20,128}$/.test(depositAddress) ||
        (funding ? token.blockchain in EVM_CHAIN_IDS : true) && !isEvmAddress(depositAddress))) {
        throw new RequestError(502, "invalid_provider_quote", "NEAR Intents did not return a usable deposit address");
      }
      const isBaseUsdc = token.assetId === BASE_USDC.id;
      const transfer = typeof depositAddress === "string" && funding && !isBaseUsdc
        ? fundTransfer(token, externalWallet, depositAddress, amount, typeof quote.depositMemo === "string" ? quote.depositMemo : null)
        : isEvmAddress(depositAddress)
        ? funding
          ? { type: "baseErc20Transfer" as const, chainId: 8453, contract: BASE_USDC.contract,
              from: input.baseAddress, to: depositAddress, amount: amount.toString(),
              // Ready for eth_sendTransaction: { from, to: contract, data, value: "0x0" } on chain 8453.
              data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [depositAddress as `0x${string}`, amount] }) }
          : { type: "hypercoreSendAsset" as const, hyperliquidChain: "Mainnet",
              from: input.venueAddress, destination: depositAddress, sourceDex: "", destinationDex: "",
              fromSubAccount: "", token: PERPS_USDC.token, amount: fromUnits(amount, origin.decimals) }
        : null;

      return {
        ...input, originAsset: origin.id, destinationAsset: destination.id, recipient, refundTo,
        amountIn: payload.amount, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut,
        originDecimals: origin.decimals, destinationDecimals: destination.decimals,
        deadline: reviewDeadline, depositDeadline: typeof depositDeadline === "string" ? depositDeadline : null,
        depositAddress: typeof depositAddress === "string" ? depositAddress : null, transfer,
        externalAsset: { assetId: token.assetId, symbol: token.symbol, blockchain: token.blockchain, decimals: token.decimals },
        correlationId: isRecord(result) && typeof result.correlationId === "string" ? result.correlationId : null,
        timeEstimate: typeof quote.timeEstimate === "number" ? quote.timeEstimate : null,
      };
    },

    /** Every external asset 1Click can route to or from Hyperliquid perps USDC. */
    async assets() {
      await checkTokens();
      return [...tokenMap.values()].filter(t => t.blockchain !== "hypercore").map(t => ({
        assetId: t.assetId, symbol: t.symbol, blockchain: t.blockchain, decimals: t.decimals,
        contractAddress: t.contractAddress ?? null, evmChainId: EVM_CHAIN_IDS[t.blockchain] ?? null, priceUsd: t.price ?? null,
      }));
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
