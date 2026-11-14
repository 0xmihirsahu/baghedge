// Owner-signed Hyperliquid "user-signed" actions (approveAgent, sendAsset) without the SDK in the browser.
// The server builds the canonical action and its EIP-712 payload; the browser wallet signs; the server checks the
// recovered signer and relays the exact action to Hyperliquid. The server never holds the owner key.
import { ApproveAgentRequest, ApproveAgentTypes, SendAssetRequest, SendAssetTypes } from "@nktkas/hyperliquid/api/exchange";
import { canonicalize } from "@nktkas/hyperliquid/signing";
import { parseSignature, recoverTypedDataAddress, type Hex } from "viem";
import { isEvmAddress } from "../shared/amounts";
import type { Network } from "./exchange";
import { isRecord, RequestError } from "./http";
import { HYPERLIQUID_URL } from "./venue";

type UserAction = Record<string, unknown> & { type: "approveAgent" | "sendAsset"; signatureChainId: Hex; nonce: number };

const TYPES = { approveAgent: ApproveAgentTypes, sendAsset: SendAssetTypes } as const;
const SCHEMA = { approveAgent: ApproveAgentRequest.entries.action, sendAsset: SendAssetRequest.entries.action } as const;
const ZERO = "0x0000000000000000000000000000000000000000";

/** EIP-712 payload for a user-signed action, ready for eth_signTypedData_v4 (uint64 as decimal strings). */
export function userTypedData(action: UserAction) {
  const types = TYPES[action.type];
  const primaryType = Object.keys(types)[0] as string;
  const fields = (types as Record<string, readonly { name: string; type: string }[]>)[primaryType]!;
  const message = Object.fromEntries(fields.map(f => [f.name, f.type === "uint64" ? String(action[f.name]) : action[f.name]]));
  return {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: parseInt(action.signatureChainId, 16), verifyingContract: ZERO },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      [primaryType]: fields,
    },
    primaryType, message,
  };
}

function build(network: Network, type: UserAction["type"], fields: Record<string, unknown>, chainId: number): UserAction {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RequestError(400, "invalid_chain", "Provide the wallet's chainId");
  const action = {
    type, signatureChainId: `0x${chainId.toString(16)}`,
    hyperliquidChain: network === "mainnet" ? "Mainnet" : "Testnet", ...fields, nonce: Date.now(),
  };
  return canonicalize(SCHEMA[type], action as never) as UserAction;
}

export function createOwnerActions(network: Network, request = fetch) {
  return {
    /** approveAgent for the guard (purpose "hedge") or a browser trading agent (purpose "trade"). */
    approveAgent(body: unknown) {
      if (!isRecord(body) || !isEvmAddress(body.agentAddress) || typeof body.chainId !== "number") {
        throw new RequestError(400, "invalid_request", "Provide agentAddress and chainId");
      }
      const days = typeof body.validDays === "number" && body.validDays > 0 && body.validDays <= 180 ? body.validDays : 90;
      const label = body.purpose === "trade" ? "baghedge-trade" : "baghedge";
      // valid_until is milliseconds (verified on testnet: extraAgents echoes the same value).
      const agentName = `${label} valid_until ${Date.now() + Math.round(days * 86_400_000)}`;
      const action = build(network, "approveAgent", { agentAddress: body.agentAddress.toLowerCase(), agentName }, body.chainId);
      return { action, typedData: userTypedData(action) };
    },

    /** sendAsset for an executable withdraw quote: the exact transfer the quote describes, nothing else. */
    sendAsset(transfer: Record<string, unknown>, chainId: number) {
      const t = transfer as { type?: string; destination?: string; sourceDex?: string; destinationDex?: string; token?: string; amount?: string; fromSubAccount?: string };
      if (t.type !== "hypercoreSendAsset") throw new RequestError(409, "not_a_payout", "This transfer is not a Hyperliquid payout");
      const action = build(network, "sendAsset", {
        destination: t.destination, sourceDex: t.sourceDex ?? "", destinationDex: t.destinationDex ?? "",
        token: t.token, amount: t.amount, fromSubAccount: t.fromSubAccount ?? "",
      }, chainId);
      return { action, typedData: userTypedData(action) };
    },

    /**
     * Relays an owner-signed action after checking who signed it. `expectedSigner` binds the relay to the account
     * the action is for (the Hedge/Trade owner); `allowDestination` pins sendAsset to a deposit address we quoted.
     */
    async submit(body: unknown, opts: { expectedSigner: string; allowDestination?: (destination: string) => boolean }) {
      if (!isRecord(body) || !isRecord(body.action) || typeof body.signature !== "string") {
        throw new RequestError(400, "invalid_request", "Provide action and signature");
      }
      const type = body.action.type;
      if (type !== "approveAgent" && type !== "sendAsset") throw new RequestError(400, "unsupported_action", "Only approveAgent and sendAsset are relayed");
      const action = canonicalize(SCHEMA[type], body.action as never) as UserAction;
      if (action.hyperliquidChain !== (network === "mainnet" ? "Mainnet" : "Testnet")) {
        throw new RequestError(409, "wrong_environment", `This server runs ${network}`);
      }
      if (type === "sendAsset" && !opts.allowDestination?.(String(action.destination).toLowerCase())) {
        throw new RequestError(403, "destination_not_quoted", "sendAsset destination must be the quoted deposit address");
      }
      const typed = userTypedData(action) as unknown as Parameters<typeof recoverTypedDataAddress>[0];
      const signer = await recoverTypedDataAddress({ ...typed, signature: body.signature as Hex }).catch(() => null);
      if (signer?.toLowerCase() !== opts.expectedSigner.toLowerCase()) {
        throw new RequestError(403, "wrong_signer", "The signature isn't from the account owner");
      }
      const sig = parseSignature(body.signature as Hex);
      const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
      const response = await request(new URL("/exchange", HYPERLIQUID_URL[network]), {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action, nonce: action.nonce, signature: { r: sig.r, s: sig.s, v } }),
      }).catch(() => null);
      if (!response) throw new RequestError(502, "provider_unavailable", "Hyperliquid did not respond; check status before retrying");
      const result: unknown = await response.json().catch(() => null);
      if (!isRecord(result) || result.status !== "ok") {
        throw new RequestError(502, "venue_rejected", `Hyperliquid: ${isRecord(result) ? String(result.response) : `HTTP ${response.status}`}`);
      }
      return { ok: true, type, signer: signer.toLowerCase(), venue: result };
    },
  };
}
