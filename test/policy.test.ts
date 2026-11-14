import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildHedgeOrder } from "../shared/orders";
import {
  deriveCloid, POLICY_TYPES, policyTypedData, ruleFromPolicy, solanaToBytes32, verifyPolicy, type HedgePolicy,
} from "../shared/policy";

// The exact string in guard/src/policy.rs. A mismatch means the guard and browser hash different policies.
const RUST_POLICY_TYPE = "HedgePolicy(string environment,bytes32 ruleId,uint32 version,uint64 policyNonce,address tradeAccount,address hedgeAccount,bytes32 watchedSolana,uint8 watchScope,string market,uint32 assetId,string priceSource,address guardAgent,bytes32 guardBuildHash,uint64 capLots,uint64 entryTriggerE8,uint64 entryFloorE8,uint64 recoveryTriggerE8,uint64 buybackCeilingE8,uint64 entryWindowMs,uint64 expiryMs,uint64 minMarginE6,bool oneCycle)";

const owner = privateKeyToAccount(generatePrivateKey());
const policy = (over: Partial<HedgePolicy> = {}): HedgePolicy => ({
  environment: "testnet", ruleId: `0x${"ab".repeat(32)}`, version: 1, policyNonce: "1794666000000",
  tradeAccount: "0x1111111111111111111111111111111111111111", hedgeAccount: owner.address,
  watchedSolana: solanaToBytes32("So11111111111111111111111111111111111111112"), watchScope: 1,
  market: "SOL", assetId: 0, priceSource: "hyperliquid-mark",
  guardAgent: "0x2222222222222222222222222222222222222222", guardBuildHash: `0x${"cd".repeat(32)}`,
  capLots: "40", entryTriggerE8: "7000000000", entryFloorE8: "6860000000", recoveryTriggerE8: "8050000000",
  buybackCeilingE8: "8200000000", entryWindowMs: "30000", expiryMs: "1794700000000", minMarginE6: "15000000",
  oneCycle: true, ...over,
});

describe("policy", () => {
  test("the EIP-712 type string matches the guard", () => {
    const encoded = `HedgePolicy(${POLICY_TYPES.HedgePolicy.map(f => `${f.type} ${f.name}`).join(",")})`;
    expect(encoded).toBe(RUST_POLICY_TYPE);
  });

  test("accepts the Hedge owner's signature and rejects anyone else's", async () => {
    const p = policy();
    const signature = await owner.signTypedData(policyTypedData(p, 42161));
    expect((await verifyPolicy(p, 42161, signature)).owner as string).toBe(owner.address.toLowerCase());
    expect(verifyPolicy(p, 1, signature)).rejects.toThrow("not signed by the Hedge owner");
    const other = privateKeyToAccount(generatePrivateKey());
    expect(verifyPolicy(p, 42161, await other.signTypedData(policyTypedData(p, 42161)))).rejects.toThrow();
  });

  test("rejects aliased accounts and inverted price bands", async () => {
    const aliased = policy({ tradeAccount: owner.address });
    expect(verifyPolicy(aliased, 1, await owner.signTypedData(policyTypedData(aliased, 1)))).rejects.toThrow("differ");
    const inverted = policy({ entryFloorE8: "7100000000" });
    expect(verifyPolicy(inverted, 1, await owner.signTypedData(policyTypedData(inverted, 1)))).rejects.toThrow("price band");
  });

  test("cloids are deterministic, 16 bytes, and distinct per intent and attempt", () => {
    const id = deriveCloid(`0x${"ab".repeat(32)}`, 1, "entry", 0);
    expect(id).toMatch(/^0x[\da-f]{32}$/);
    expect(deriveCloid(`0x${"ab".repeat(32)}`, 1, "entry", 0)).toBe(id);
    expect(deriveCloid(`0x${"ab".repeat(32)}`, 1, "stop", 0)).not.toBe(id);
    expect(deriveCloid(`0x${"ab".repeat(32)}`, 1, "entry", 1)).not.toBe(id);
    expect(deriveCloid(`0x${"ab".repeat(32)}`, 2, "entry", 0)).not.toBe(id);
  });

  test("solana addresses decode to 32 bytes", () => {
    expect(solanaToBytes32("11111111111111111111111111111111")).toBe(`0x${"00".repeat(32)}`);
    expect(() => solanaToBytes32("111")).toThrow();
  });
});

describe("ruleFromPolicy", () => {
  test("rounds the floor up and the ceiling down to venue precision, never across the signed bound", () => {
    const rule = ruleFromPolicy(policy({ entryFloorE8: "6860123456", buybackCeilingE8: "8209999999" }), 2);
    expect(rule.priceDecimals).toBe(4);
    expect(rule.entryFloor).toBe(686020n);    // 68.602 ≥ 68.60123456, 5 sig figs
    expect(rule.exitCeiling).toBe(820990n);   // 82.099 ≤ 82.09999999
    expect(rule.entryMark).toBe(700000n);
    const order = buildHedgeOrder({ asset: 0, sizeDecimals: 2 }, rule.priceDecimals, rule,
      { kind: "entry", lots: 40n, limit: rule.entryFloor, reduceOnly: false },
      { order: deriveCloid(policy().ruleId, 1, "entry", 0), recovery: deriveCloid(policy().ruleId, 1, "stop", 0) });
    expect(order.grouping).toBe("normalTpsl");
    expect(order.orders[0]!.p).toBe("68.602");
    expect(order.orders[1]!.p).toBe("82.099");
    expect(order.orders[0]!.s).toBe("0.4");
  });

  test("a trigger that doesn't fit venue precision is refused rather than silently moved", () => {
    expect(() => ruleFromPolicy(policy({ entryTriggerE8: "7000012345" }), 2)).toThrow("Entry trigger");
  });
});
