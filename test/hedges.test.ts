import { expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { policyTypedData, solanaToBytes32, type HedgePolicy } from "../shared/policy";
import { openDb } from "../server/db";
import type { Exchange } from "../server/exchange";
import { createHedgeRoutes } from "../server/hedges";
import { createSessions } from "../server/session";

const owner = privateKeyToAccount(generatePrivateKey());
const agent = "0x2222222222222222222222222222222222222222" as const;
const buildHash = `0x${"cd".repeat(32)}` as const;

const exchange = {
  market: async () => ({ asset: 0, sizeDecimals: 2, markPx: "75", bestBid: "74.9", bestAsk: "75.1", maxLeverage: 10,
    markObservedAt: Date.now(), bookObservedAt: Date.now(), observedAt: Date.now() }),
  position: async () => ({ szi: "0", liquidationPx: null, withdrawable: "30", accountValue: "30", observedAt: Date.now() }),
  openOrders: async () => [],
  usableUsdc: async () => usable,
} as unknown as Exchange;
let usable = { mode: "standard", usableUsdc: "30", perpsWithdrawable: "30", spotAvailable: "0", observedAt: Date.now() };

function routes() {
  const db = openDb(":memory:");
  const sessions = createSessions({ env: "testnet", db, origin: "http://localhost:5173", secureCookie: false });
  const r = createHedgeRoutes({
    env: "testnet", db, exchange, signer: { kind: "fallback", agentAddress: agent, buildHash },
    sessionAddresses: req => sessions.addresses(req),
    readWallet: async () => ({ lamports: "1000000000", observedAt: Date.now() }),
  });
  const post = (path: string, body: unknown) => r.route(new Request(`http://x${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), new URL(`http://x${path}`));
  const get = (path: string, cookie?: string) => r.route(new Request(`http://x${path}`, cookie ? { headers: { cookie } } : {}), new URL(`http://x${path}`));
  const signIn = async (account: typeof owner) => {
    const { message, nonce } = sessions.challenge({ address: account.address });
    const out = await sessions.verify({ nonce, signature: await account.signMessage({ message }) });
    return out.setCookie.split(";")[0]!;
  };
  return { db, post, get, sessions, signIn };
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

test("rule reads require the owner's session; challenges are single-use", async () => {
  const { post, get, sessions, signIn } = routes();
  const ownerSig = await owner.signTypedData(policyTypedData(policy, 1));
  const armed = await post("/api/hedges", { policy, ownerSig, chainId: 1 }) as { id: string };

  expect(get(`/api/hedges/${armed.id}`)).rejects.toThrow("Sign in");
  const stranger = privateKeyToAccount(generatePrivateKey());
  expect(get(`/api/hedges/${armed.id}`, await signIn(stranger))).rejects.toThrow("Sign in");
  expect(get(`/api/hedges?hedge=${owner.address}`, await signIn(stranger))).rejects.toThrow("Sign in");

  const cookie = await signIn(owner);
  expect(((await get(`/api/hedges/${armed.id}`, cookie)) as { id: string }).id).toBe(armed.id);
  expect(((await get(`/api/hedges?hedge=${owner.address}`, cookie)) as { rules: unknown[] }).rules).toHaveLength(1);

  // A signature over one challenge can't be replayed, and can't be used for another address's challenge.
  const { message, nonce } = sessions.challenge({ address: owner.address });
  const signature = await owner.signMessage({ message });
  await sessions.verify({ nonce, signature });
  expect(sessions.verify({ nonce, signature })).rejects.toThrow("expired");
  const other = sessions.challenge({ address: stranger.address });
  expect(sessions.verify({ nonce: other.nonce, signature })).rejects.toThrow("does not match");
});

test("required margin matches the section 23 worked example (~$192 for a 6 SOL short, $140 → $161)", async () => {
  const { requiredMarginE6 } = await import("../server/hedges");
  // 6 SOL = 600 lots; floor $140, ceiling $161; SOL max leverage 20 (maintenance 2.5%).
  const e6 = requiredMarginE6(600n, 2, 14_000_000_000n, 16_100_000_000n, 20);
  // loss $126 + maintenance $24.15 + fees ~$0.87 + 5% buffer $42 ≈ $193
  expect(Number(e6) / 1e6).toBeGreaterThan(190);
  expect(Number(e6) / 1e6).toBeLessThan(196);
});

test("a unified account's spot USDC counts as margin; an empty account is refused", async () => {
  const { post } = routes();
  const p = { ...policy, ruleId: `0x${"cd".repeat(32)}` as `0x${string}`, minMarginE6: "5000000" };
  const ownerSig = await owner.signTypedData(policyTypedData(p, 1));
  usable = { mode: "unified", usableUsdc: "0", perpsWithdrawable: "0", spotAvailable: "0", observedAt: Date.now() };
  expect(post("/api/hedges", { policy: p, ownerSig, chainId: 1 })).rejects.toThrow("(unified) has 0 USDC");
  usable = { mode: "unified", usableUsdc: "12", perpsWithdrawable: "0", spotAvailable: "12", observedAt: Date.now() };
  const armed = await post("/api/hedges", { policy: p, ownerSig, chainId: 1 }) as { phase: string };
  expect(armed.phase).toBe("armed");
  usable = { mode: "standard", usableUsdc: "30", perpsWithdrawable: "30", spotAvailable: "0", observedAt: Date.now() };
});

test("arm recomputes the margin floor: a signed minMarginE6 of 0 with a big cap is still refused when underfunded", async () => {
  const { post } = routes();
  const p = { ...policy, ruleId: `0x${"ef".repeat(32)}` as `0x${string}`, capLots: "100000", minMarginE6: "0" };
  const ownerSig = await owner.signTypedData(policyTypedData(p, 1));
  expect(post("/api/hedges", { policy: p, ownerSig, chainId: 1 })).rejects.toThrow("this rule needs");
});

test("multi-owner guard: each Hedge owner gets their own agent; a policy naming another owner's agent is refused", async () => {
  const db = openDb(":memory:");
  const sessions = createSessions({ env: "testnet", db, origin: "http://localhost:5173", secureCookie: false });
  const agentOf = (o: string) => (`0x${o.slice(2, 10)}${"a".repeat(32)}`).toLowerCase() as `0x${string}`;
  const known = new Set<string>();
  const r = createHedgeRoutes({
    env: "testnet", db, exchange, sessionAddresses: req => sessions.addresses(req),
    signer: { kind: "guard", agentAddress: null, buildHash, agentFor: async (o, { discover }) => (known.has(o.toLowerCase()) || discover) ? (known.add(o.toLowerCase()), { agentAddress: agentOf(o) }) : null },
    readWallet: async () => ({ lamports: "1000000000", observedAt: Date.now() }),
  });
  const call = (method: string, path: string, body?: unknown) => r.route(new Request(`http://x${path}`, {
    method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  }), new URL(`http://x${path}`));

  // Discovery (a paid guard call) needs the owner's session.
  expect(call("GET", `/api/hedges/agent?owner=${owner.address}`)).rejects.toThrow("Sign in");
  const { message, nonce } = sessions.challenge({ address: owner.address });
  const cookie = (await sessions.verify({ nonce, signature: await owner.signMessage({ message }) })).setCookie.split(";")[0]!;
  const agent = await r.route(new Request(`http://x/api/hedges/agent?owner=${owner.address}`, { headers: { cookie } }),
    new URL(`http://x/api/hedges/agent?owner=${owner.address}`)) as { agentAddress: string; multiOwner: boolean };
  expect(agent).toMatchObject({ agentAddress: agentOf(owner.address.toLowerCase()), multiOwner: true });

  // A policy carrying this owner's derived agent arms.
  const mine = { ...policy, ruleId: `0x${"11".repeat(32)}` as `0x${string}`, guardAgent: agentOf(owner.address.toLowerCase()) };
  const armed = await call("POST", "/api/hedges", { policy: mine, ownerSig: await owner.signTypedData(policyTypedData(mine, 1)), chainId: 1 }) as { phase: string };
  expect(armed.phase).toBe("armed");

  // The same owner's policy naming someone else's agent is refused.
  const other = privateKeyToAccount(generatePrivateKey());
  const wrong = { ...policy, ruleId: `0x${"22".repeat(32)}` as `0x${string}`, guardAgent: agentOf(other.address.toLowerCase()) };
  expect(call("POST", "/api/hedges", { policy: wrong, ownerSig: await owner.signTypedData(policyTypedData(wrong, 1)), chainId: 1 }))
    .rejects.toThrow("different hedge signer");
});

test("multi-owner agent cache: durable, one guard call per owner, rate-limited misses, no discovery without consent", async () => {
  const { multiOwnerAgentCache } = await import("../server/index");
  const db = openDb(":memory:");
  const cache = multiOwnerAgentCache(db, "mainnet", "0xbuild", "exec.near");
  let calls = 0;
  const lookup = async (o: `0x${string}`) => { calls++; await Bun.sleep(5); return { agentAddress: `0x${"b".repeat(40)}` as `0x${string}`, attestationTxHash: "tx" }; };
  const o = "0x1111111111111111111111111111111111111111" as const;
  expect(await cache.get(o, false, lookup)).toBeNull();                       // no consent → no paid call
  const [a, b] = await Promise.all([cache.get(o, true, lookup), cache.get(o, true, lookup)]);
  expect(a?.agentAddress).toBe(b?.agentAddress!);
  expect(calls).toBe(1);                                                       // coalesced
  expect((await cache.get(o, false, lookup))?.attestationTxHash).toBe("tx");  // durable
  const o2 = "0x2222222222222222222222222222222222222222" as const;
  await cache.get(o2, true, async () => { throw new Error("guard down"); }).catch(() => {});
  expect(cache.get(o2, true, lookup)).rejects.toThrow("Try again in a minute"); // rate-limited after a miss
  // A different build or executor gets fresh agents.
  expect(await multiOwnerAgentCache(db, "mainnet", "0xotherbuild", "exec.near").get(o, false, lookup)).toBeNull();
});

test("a guard pinned to one Hedge owner refuses other owners at draft and arm, before any signature", async () => {
  const db = openDb(":memory:");
  const sessions = createSessions({ env: "testnet", db, origin: "http://localhost:5173", secureCookie: false });
  const r = createHedgeRoutes({
    env: "testnet", db, exchange, sessionAddresses: req => sessions.addresses(req),
    signer: { kind: "guard", agentAddress: agent, buildHash, pinnedOwner: "0x9999999999999999999999999999999999999999" },
    readWallet: async () => ({ lamports: "1000000000", observedAt: Date.now() }),
  });
  const post = (path: string, body: unknown) => r.route(new Request(`http://x${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), new URL(`http://x${path}`));
  expect(post("/api/hedges/draft", { tradeAddress: policy.tradeAccount, hedgeAddress: owner.address, solanaAddress: "So11111111111111111111111111111111111111112",
    maxSol: "0.4", entryMark: "70", entryFloor: "68.6", recoveryMark: "80.5", exitCeiling: "82", expiresAt: Date.now() + 3_600_000 })).rejects.toThrow("only sign for its configured Hedge account");
  const ownerSig = await owner.signTypedData(policyTypedData(policy, 1));
  expect(post("/api/hedges", { policy, ownerSig, chainId: 1 })).rejects.toThrow("only sign for its configured Hedge account");
});
