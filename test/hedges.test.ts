import { expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { policyTypedData, solanaToBytes32, type HedgePolicy } from "../shared/policy";
import { openDb } from "../server/db";
import type { Exchange } from "../server/exchange";
import { createHedgeRoutes } from "../server/hedges";

const owner = privateKeyToAccount(generatePrivateKey());
const agent = "0x2222222222222222222222222222222222222222" as const;
const buildHash = `0x${"cd".repeat(32)}` as const;

const exchange = {
  market: async () => ({ asset: 0, sizeDecimals: 2, markPx: "75", bestBid: "74.9", bestAsk: "75.1", observedAt: Date.now() }),
  position: async () => ({ szi: "0", liquidationPx: null, withdrawable: "30", accountValue: "30", observedAt: Date.now() }),
  openOrders: async () => [],
} as unknown as Exchange;

function routes() {
  const db = openDb(":memory:");
  const r = createHedgeRoutes({
    env: "testnet", db, exchange, signer: { kind: "fallback", agentAddress: agent, buildHash },
    readWallet: async () => ({ lamports: "1000000000", observedAt: Date.now() }),
  });
  const post = (path: string, body: unknown) => r.route(new Request(`http://x${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), new URL(`http://x${path}`));
  return { db, post };
}

const policy: HedgePolicy = {
  environment: "testnet", ruleId: `0x${"ab".repeat(32)}`, version: 1, policyNonce: "1",
  tradeAccount: "0x1111111111111111111111111111111111111111", hedgeAccount: owner.address.toLowerCase() as `0x${string}`,
  watchedSolana: solanaToBytes32("So11111111111111111111111111111111111111112"), watchScope: 1, market: "SOL", assetId: 0,
  priceSource: "hyperliquid-mark", guardAgent: agent, guardBuildHash: buildHash, capLots: "40",
  entryTriggerE8: "7000000000", entryFloorE8: "6860000000", recoveryTriggerE8: "8050000000", buybackCeilingE8: "8200000000",
  entryWindowMs: "30000", expiryMs: String(Date.now() + 3_600_000), minMarginE6: "0", oneCycle: true,
};

test("a signed policy arms once; case variants and resubmissions are refused even after the rule ends", async () => {
  const { db, post } = routes();
  const ownerSig = await owner.signTypedData(policyTypedData(policy, 1));
  const armed = await post("/api/hedges", { policy, ownerSig, chainId: 1 }) as { id: string; phase: string };
  expect(armed.phase).toBe("armed");
  db.updateRule(armed.id, { status: "done" });

  const upper = { ...policy, ruleId: policy.ruleId.toUpperCase().replace("0X", "0x") };
  expect(post("/api/hedges", { policy: upper, ownerSig, chainId: 1 })).rejects.toThrow("lowercase hex");
  expect(post("/api/hedges", { policy, ownerSig, chainId: 1 })).rejects.toThrow("already used");
});

test("a policy naming a different signer than the server runs is refused", async () => {
  const { post } = routes();
  const other = { ...policy, guardAgent: "0x4444444444444444444444444444444444444444" as const };
  const ownerSig = await owner.signTypedData(policyTypedData(other, 1));
  expect(post("/api/hedges", { policy: other, ownerSig, chainId: 1 })).rejects.toThrow("different hedge signer");
});
