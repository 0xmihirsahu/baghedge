// End-to-end HTTP check of the browser API against a running backend, exactly as a frontend calls it.
// Uses the local TEST wallets (.env.testwallets). Read-mostly: it never arms a second rule or moves funds.
//   bun scripts/live/api-smoke.ts [http://localhost:3001]
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const API = process.argv[2] ?? "http://localhost:3001";
const env = Object.fromEntries(readFileSync(".env.testwallets", "utf8").split("\n")
  .filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const trade = privateKeyToAccount(env.TEST_TRADE_PRIVATE_KEY as Hex);
const hedge = privateKeyToAccount(env.TEST_HEDGE_PRIVATE_KEY as Hex);
const solana = env.TEST_SOLANA_ADDRESS!;
let failures = 0;

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(API + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
}
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 300)}`);
}

const health = await call("GET", "/api/health");
check("health: testnet with a hedge signer", health.status === 200 && health.data.mode === "testnet" && !!health.data.hedgeSigner, health.data);

const markets = await call("GET", "/api/markets");
const sol = markets.data.markets?.find((m: any) => m.coin === "SOL");
check("markets: SOL present with runtime asset id and precision", !!sol && Number.isInteger(sol.asset) && sol.sizeDecimals === 2, sol);

const accounts = await call("GET", `/api/accounts?trade=${trade.address}&hedge=${hedge.address}`);
check("accounts: both accounts with spotUsdc field", accounts.status === 200 && "spotUsdc" in accounts.data.trade && "spotUsdc" in accounts.data.hedge, accounts.data);
check("accounts: aliased accounts rejected", (await call("GET", `/api/accounts?trade=${hedge.address}&hedge=${hedge.address}`)).data.error === "account_alias");

const wallet = await call("GET", `/api/wallet/sol?address=${solana}`);
check("wallet: lamports as string with slot", wallet.status === 200 && /^\d+$/.test(wallet.data.lamports) && wallet.data.slot > 0, wallet.data);

const mark = Number(sol.markPrice);
const draft = await call("POST", "/api/hedges/draft", {
  tradeAddress: trade.address, hedgeAddress: hedge.address, solanaAddress: solana, maxSol: "0.4",
  entryMark: (mark * 0.9).toFixed(2), entryFloor: (mark * 0.88).toFixed(2), recoveryMark: (mark * 1.05).toFixed(2),
  exitCeiling: (mark * 1.07).toFixed(2), expiresAt: Date.now() + 3_600_000, chainId: 421614,
});
check("draft: policy, requiredMarginUsdc and ready-to-sign typedData", draft.status === 200 && Number(draft.data.requiredMarginUsdc) > 0 &&
  draft.data.typedData?.primaryType === "HedgePolicy" && draft.data.policy.minMarginE6 !== "0", draft.data);

// Sign exactly the typedData the server returned, the way a frontend would, and try to arm.
const { EIP712Domain: _d, ...types } = draft.data.typedData.types;
const ownerSig = await hedge.signTypedData({ domain: draft.data.typedData.domain, types, primaryType: "HedgePolicy", message: draft.data.typedData.message });
const arm = await call("POST", "/api/hedges", { policy: draft.data.policy, ownerSig, chainId: 421614 });
check("arm: signed typedData verifies; second rule refused while one is active", arm.status === 409 && arm.data.error === "rule_active", arm.data);
const forged = await call("POST", "/api/hedges", { policy: draft.data.policy, ownerSig: await trade.signTypedData({ domain: draft.data.typedData.domain, types, primaryType: "HedgePolicy", message: draft.data.typedData.message }), chainId: 421614 });
check("arm: policy signed by a non-owner refused", forged.status === 400 && forged.data.error === "invalid_policy", forged.data);

check("rules: read without session refused", (await call("GET", `/api/hedges?hedge=${hedge.address}`)).status === 401);
const challenge = await call("POST", "/api/session/challenge", { address: hedge.address });
const verify = await call("POST", "/api/session/verify", { nonce: challenge.data.nonce, signature: await hedge.signMessage({ message: challenge.data.message }) });
const cookie = verify.setCookie?.split(";")[0];
check("session: sign-in sets an HttpOnly cookie", verify.status === 200 && !!cookie && /HttpOnly/i.test(verify.setCookie ?? ""), verify.data);
check("session: GET /api/session lists the address", (await call("GET", "/api/session", undefined, cookie)).data.addresses?.includes(hedge.address.toLowerCase()));

const rules = await call("GET", `/api/hedges?hedge=${hedge.address}`, undefined, cookie);
const rule = rules.data.rules?.[0];
check("rules: active rule visible to its owner with actions and fills arrays", rules.status === 200 && !!rule && Array.isArray(rule.actions) && Array.isArray(rule.fills), rules.data);
if (rule) {
  check("rule by id", (await call("GET", `/api/hedges/${rule.id}`, undefined, cookie)).data.id === rule.id);
  const cmd = await call("GET", `/api/hedges/${rule.id}?command=close&chainId=421614`);
  check("command typedData: ready to sign without a session", cmd.status === 200 && cmd.data.typedData?.primaryType === "HedgeCommand", cmd.data);
  const strangerSig = await trade.signTypedData({ domain: cmd.data.typedData.domain,
    types: { HedgeCommand: cmd.data.typedData.types.HedgeCommand }, primaryType: "HedgeCommand", message: cmd.data.typedData.message });
  const strangerClose = await call("POST", `/api/hedges/${rule.id}/close`, { signature: strangerSig, issuedAt: cmd.data.issuedAt, chainId: 421614 });
  check("close: signed by the Trade owner (not Hedge) refused", strangerClose.status === 403, strangerClose.data);

  const ctrl = new AbortController();
  const sse = await fetch(`${API}/api/events?rule=${rule.id}`, { headers: { cookie: cookie! }, signal: ctrl.signal });
  const reader = sse.body!.getReader();
  const first = await Promise.race([reader.read(), new Promise<{ value?: Uint8Array }>(r => setTimeout(() => r({}), 3000))]);
  ctrl.abort();
  const text = first.value ? new TextDecoder().decode(first.value) : "";
  check("events: SSE stream replays this rule's events", sse.status === 200 && /event: armed/.test(text), text.slice(0, 200));
  check("events: without session refused", (await call("GET", `/api/events?rule=${rule.id}`)).status === 401);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
