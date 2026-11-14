"use client";

import { useEffect, useState } from "react";

// money in and out of the Hyperliquid accounts through NEAR Intents (docs/API.md "Funding", docs/INTEGRATION.md §2, §7).
// any of the ~228 tokens 1Click lists, on 38 chains, becomes Hyperliquid USDC; a payout is the same in reverse.
// executable quotes are mainnet only: Intents has no testnet

export type Asset = { assetId: string; symbol: string; blockchain: string; decimals: number; contractAddress: string | null; evmChainId: number | null; priceUsd: number | null };

export type Transfer =
  | { type: "solanaTransfer"; from: string; to: string; mint: string | null; amount: string; decimals: number }
  | { type: "evmErc20Transfer" | "baseErc20Transfer"; chainId: number; contract: string; from: string; to: string; amount: string; data: string }
  | { type: "evmNativeTransfer"; chainId: number; from: string; to: string; value: string }
  | { type: "deposit"; blockchain: string; assetId: string; from: string; to: string; amount: string; memo: string | null }
  | { type: "hypercoreSendAsset"; destination: string; amount: string; token: string };

export type Quote = {
  id: string | null;
  direction: "fund" | "withdraw";
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  originDecimals: number;
  destinationDecimals: number;
  deadline: string | null;
  depositAddress: string | null;
  timeEstimate: number | null;
  transfer: Transfer | null;
  externalAsset: { assetId: string; symbol: string; blockchain: string; decimals: number };
};

export type Status = {
  status: string;
  swapDetails: { originChainTxHashes?: { hash: string; explorerUrl?: string }[]; destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]; refundedAmountFormatted?: string } | null;
  recipientAccount: { usableUsdc: string | null } | null;
};

export class FundsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// the backend's refusals, in plain words
const MESSAGES: Record<string, string> = {
  mainnet_only: "Funding runs on mainnet. NEAR Intents has no testnet.",
  invalid_amount: "Check the amount: too many decimals, or zero.",
  invalid_address: "That address doesn't match the chain.",
  unsupported_asset: "That token can't be routed right now. Pick another.",
  provider_unavailable: "NEAR Intents is busy. Try again in a moment.",
  provider_error: "NEAR Intents couldn't quote that. Try a larger amount.",
  invalid_provider_quote: "NEAR Intents returned a bad quote. Try again.",
  quote_expired: "The quote ran out. Get a new one.",
  transfer_mismatch: "The signed transfer didn't match the quote. Start again.",
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new FundsError("unreachable", "Couldn't reach baghedge. Try again.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new FundsError(j.error ?? "unknown", MESSAGES[j.error] ?? String(j.message ?? "Something went wrong. Try again."));
  return j as T;
}

export const quote = (q: { direction: "fund" | "withdraw"; role: "trade" | "hedge"; baseAddress: string; venueAddress: string; amount: string; externalAsset: string; dry: boolean }) =>
  call<Quote>("/api/transfers/quote", q);
export const transferStatus = (id: string) => call<Status>(`/api/transfers/${id}`);
export const sendAssetPayload = (id: string, chainId: number) =>
  call<{ action: unknown; typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> } }>(`/api/transfers/${id}/send-asset`, { chainId });
export const sendAssetSubmit = (id: string, action: unknown, signature: string) => call(`/api/transfers/${id}/send-asset/submit`, { action, signature });
export const reportDeposit = (id: string, txHash: string) => call(`/api/transfers/${id}/deposit`, { txHash }).catch(() => null);

// every external asset 1Click routes to or from Hyperliquid USDC, read once
let assets: Promise<Asset[]> | null = null;
export function useAssets() {
  const [list, setList] = useState<Asset[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    assets ??= call<{ assets: Asset[] }>("/api/transfers/assets").then((r) => r.assets);
    assets.then(
      (a) => setList(a),
      () => {
        assets = null;
        setFailed(true);
      },
    );
  }, []);
  return { list, failed };
}

// the ones people reach for first, in this order; everything else follows by chain
const POPULAR: [string, string][] = [
  ["SOL", "sol"], ["USDC", "sol"], ["USDC", "base"], ["USDC", "arb"], ["USDC", "eth"], ["ETH", "base"], ["ETH", "eth"], ["ETH", "arb"], ["USDT", "eth"], ["USDT", "sol"], ["wNEAR", "near"], ["BTC", "btc"],
];
export function sortAssets(list: Asset[]) {
  const rank = (a: Asset) => {
    const i = POPULAR.findIndex(([s, b]) => s === a.symbol && b === a.blockchain);
    return i < 0 ? 100 : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
}
export const SOL_ASSET = "nep141:sol.omft.near";

const CHAINS: Record<string, string> = {
  sol: "Solana", eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche",
  near: "NEAR", btc: "Bitcoin", gnosis: "Gnosis", bera: "Berachain", scroll: "Scroll", sui: "Sui", aptos: "Aptos", tron: "Tron",
  ton: "TON", doge: "Dogecoin", xrp: "XRP Ledger", zec: "Zcash", ltc: "Litecoin", bch: "Bitcoin Cash", dash: "Dash", cardano: "Cardano",
  stellar: "Stellar", starknet: "Starknet", monad: "Monad", plasma: "Plasma", xlayer: "X Layer", hood: "Robinhood Chain", movement: "Movement",
};
export const chainName = (b: string) => CHAINS[b] ?? b.charAt(0).toUpperCase() + b.slice(1);
// how this chain's wallet sends: our Solana adapter, an EVM wallet, or by hand to a deposit address
export const sourceKind = (a: Asset) => (a.blockchain === "sol" ? "solana" : a.evmChainId ? "evm" : "manual");

// units ↔ decimals, exact for display
export const fromUnits = (v: string, d: number) => Number(v) / 10 ** d;
export const toFixedTrim = (n: number, max = 6) => Number(n.toFixed(max)).toString();

// where a step can be checked
const EVM_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io", 8453: "https://basescan.org", 42161: "https://arbiscan.io", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com",
  56: "https://bscscan.com", 43114: "https://snowtrace.io", 100: "https://gnosisscan.io", 80094: "https://berascan.com", 534352: "https://scrollscan.com",
};
export const solanaTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const evmTx = (chainId: number, hash: string) => `${EVM_EXPLORERS[chainId] ?? "https://blockscan.com"}/tx/${hash}`;
export const intentsTx = (depositAddress: string) => `https://explorer.near-intents.org/transactions/${depositAddress}`;

// what each NEAR Intents state means to the person waiting (docs/INTEGRATION.md §12)
export const STEPS = ["Waiting for your deposit", "Deposit detected", "In transit", "Done"] as const;
export function stepOf(s: Status | null, direction: "fund" | "withdraw") {
  const st = s?.status ?? "PENDING_DEPOSIT";
  // funding counts as done only when the Hyperliquid account shows the USDC, not when the provider says so
  if (st === "SUCCESS") return direction === "fund" && !(Number(s?.recipientAccount?.usableUsdc ?? 0) > 0) ? 2 : 3;
  return { PENDING_DEPOSIT: 0, KNOWN_DEPOSIT_TX: 1, PROCESSING: 2 }[st] ?? 0;
}
export const failedState = (s: Status | null) =>
  s?.status === "REFUNDED" ? "Refunded to your wallet." : s?.status === "FAILED" ? "The transfer failed. Nothing was taken beyond network fees." : s?.status === "INCOMPLETE_DEPOSIT" ? "The deposit was short of the quote, so it's being refunded." : null;
