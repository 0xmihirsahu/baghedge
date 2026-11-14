// Browser-safe. Mirrors guard/src/policy.rs (POLICY_TYPE and domain). Change neither without Codex.
import { concat, hashTypedData, keccak256, numberToHex, recoverTypedDataAddress, stringToHex, type Hex } from "viem";
import type { HedgeRule } from "./hedge";

export const POLICY_TYPES = {
  HedgePolicy: [
    { name: "environment", type: "string" },
    { name: "ruleId", type: "bytes32" },
    { name: "version", type: "uint32" },
    { name: "policyNonce", type: "uint64" },
    { name: "tradeAccount", type: "address" },
    { name: "hedgeAccount", type: "address" },
    { name: "watchedSolana", type: "bytes32" },
    { name: "watchScope", type: "uint8" },
    { name: "market", type: "string" },
    { name: "assetId", type: "uint32" },
    { name: "priceSource", type: "string" },
    { name: "guardAgent", type: "address" },
    { name: "guardBuildHash", type: "bytes32" },
    { name: "capLots", type: "uint64" },
    { name: "entryTriggerE8", type: "uint64" },
    { name: "entryFloorE8", type: "uint64" },
    { name: "recoveryTriggerE8", type: "uint64" },
    { name: "buybackCeilingE8", type: "uint64" },
    { name: "entryWindowMs", type: "uint64" },
    { name: "expiryMs", type: "uint64" },
    { name: "minMarginE6", type: "uint64" },
    { name: "oneCycle", type: "bool" },
  ],
} as const;

export const policyDomain = (chainId: number) => ({ name: "Baghedge", version: "1", chainId }) as const;

const UINT64_FIELDS = [
  "policyNonce", "capLots", "entryTriggerE8", "entryFloorE8", "recoveryTriggerE8",
  "buybackCeilingE8", "entryWindowMs", "expiryMs", "minMarginE6",
] as const;

/** JSON wire form shared with the guard: uint64 values are decimal strings, bytes are 0x-hex. */
export type HedgePolicy = {
  environment: "mainnet" | "testnet";
  ruleId: Hex;
  version: number;
  policyNonce: string;
  tradeAccount: Hex;
  hedgeAccount: Hex;
  watchedSolana: Hex;
  watchScope: number;
  market: "SOL";
  assetId: number;
  priceSource: "hyperliquid-mark";
  guardAgent: Hex;
  guardBuildHash: Hex;
  capLots: string;
  entryTriggerE8: string;
  entryFloorE8: string;
  recoveryTriggerE8: string;
  buybackCeilingE8: string;
  entryWindowMs: string;
  expiryMs: string;
  minMarginE6: string;
  oneCycle: boolean;
};

export function policyMessage(policy: HedgePolicy) {
  const message: Record<string, unknown> = { ...policy };
  for (const field of UINT64_FIELDS) {
    if (!/^\d{1,20}$/.test(policy[field]) || BigInt(policy[field]) >= 2n ** 64n) throw new Error(`Invalid ${field}`);
    message[field] = BigInt(policy[field]);
  }
  return message as Omit<HedgePolicy, (typeof UINT64_FIELDS)[number]> & Record<(typeof UINT64_FIELDS)[number], bigint>;
}

export function policyTypedData(policy: HedgePolicy, chainId: number) {
  return {
    domain: policyDomain(chainId), types: POLICY_TYPES, primaryType: "HedgePolicy" as const,
    message: policyMessage(policy),
  };
}

export const policyDigest = (policy: HedgePolicy, chainId: number) => hashTypedData(policyTypedData(policy, chainId));

/** Checks the structural rules the guard also enforces, then that the Hedge owner signed it. */
export async function verifyPolicy(policy: HedgePolicy, chainId: number, signature: Hex) {
  const e = (name: keyof HedgePolicy) => BigInt(policy[name] as string);
  if (policy.tradeAccount.toLowerCase() === policy.hedgeAccount.toLowerCase()) throw new Error("Trade and Hedge accounts must differ");
  if (policy.market !== "SOL" || policy.priceSource !== "hyperliquid-mark" || !policy.oneCycle) throw new Error("Unsupported policy market");
  if (policy.version < 1 || (policy.watchScope & 1) === 0 || (policy.watchScope & ~15) !== 0) throw new Error("Invalid policy scope");
  if (e("capLots") <= 0n || e("entryFloorE8") <= 0n || e("entryFloorE8") > e("entryTriggerE8") ||
    e("entryTriggerE8") >= e("recoveryTriggerE8") || e("recoveryTriggerE8") > e("buybackCeilingE8") ||
    e("entryWindowMs") <= 0n || e("expiryMs") <= 0n) throw new Error("Invalid policy price band or limits");
  const signer = await recoverTypedDataAddress({ ...policyTypedData(policy, chainId), signature });
  if (signer.toLowerCase() !== policy.hedgeAccount.toLowerCase()) throw new Error("Policy is not signed by the Hedge owner");
  return { digest: policyDigest(policy, chainId), owner: signer.toLowerCase() as Hex };
}

export type CloidIntent = "entry" | "stop" | "resize" | "close" | "position_stop";

/** First 16 bytes of keccak256(ruleId ‖ u32be(version) ‖ utf8(intent) ‖ u32be(seq)). Agreed with Codex. */
export function deriveCloid(ruleId: Hex, version: number, intent: CloidIntent, seq: number): Hex {
  if (!/^0x[\da-f]{64}$/i.test(ruleId)) throw new Error("ruleId must be bytes32");
  const hash = keccak256(concat([ruleId, numberToHex(version, { size: 4 }), stringToHex(intent), numberToHex(seq, { size: 4 })]));
  return hash.slice(0, 34).toLowerCase() as Hex;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes a Solana address to its 32-byte public key as bytes32 hex. */
export function solanaToBytes32(address: string): Hex {
  let n = 0n;
  for (const char of address) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error("Invalid base58");
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16);
  const leading = address.match(/^1*/)?.[0].length ?? 0;
  const body = n === 0n ? "" : hex.padStart(hex.length + (hex.length % 2), "0");
  if (leading + body.length / 2 !== 32) throw new Error("Solana address must decode to 32 bytes");
  return ("0x" + "00".repeat(leading) + body) as Hex;
}

/**
 * Converts the signed policy into the decision engine's rule, with prices at the venue's order precision.
 * The entry floor rounds up and the buyback ceiling rounds down so a wire price can never cross a signed bound.
 */
export function ruleFromPolicy(policy: HedgePolicy, sizeDecimals: number): HedgeRule & { priceDecimals: number } {
  const priceDecimals = 6 - sizeDecimals;
  const scale = 10n ** BigInt(8 - priceDecimals);
  const exact = (e8: string, name: string) => {
    const value = BigInt(e8);
    if (value % scale !== 0n || !fitsSigFigs(value / scale)) throw new Error(`${name} does not fit the venue price precision`);
    return value / scale;
  };
  const floorUp = (value: bigint) => {
    let units = (value + scale - 1n) / scale;
    while (!fitsSigFigs(units)) units = roundSig(units, "up");
    return units;
  };
  const ceilDown = (value: bigint) => {
    let units = value / scale;
    while (!fitsSigFigs(units)) units = roundSig(units, "down");
    return units;
  };
  const fitsSigFigs = (units: bigint) => {
    // Integer prices are always valid; otherwise at most 5 significant figures.
    if (units % 10n ** BigInt(priceDecimals) === 0n) return true;
    return units.toString().replace(/0+$/, "").length <= 5;
  };
  const roundSig = (units: bigint, dir: "up" | "down") => {
    const digits = units.toString().length;
    const step = 10n ** BigInt(Math.max(0, digits - 5));
    return dir === "up" ? ((units + step - 1n) / step) * step : (units / step) * step;
  };
  return {
    priceDecimals,
    maxLots: BigInt(policy.capLots),
    entryMark: exact(policy.entryTriggerE8, "Entry trigger"),
    recoveryMark: exact(policy.recoveryTriggerE8, "Recovery trigger"),
    entryFloor: floorUp(BigInt(policy.entryFloorE8)),
    exitCeiling: ceilDown(BigInt(policy.buybackCeilingE8)),
    endTime: Number(policy.expiryMs),
    entryWindowMs: Number(policy.entryWindowMs),
  };
}
