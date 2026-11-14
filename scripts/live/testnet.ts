// Testnet rehearsal driver. Signs with local TEST keys from .env.testwallets (gitignored) and talks to the
// local backend (APP_MODE=testnet). Appends evidence (public data only) to docs/evidence/testnet.jsonl.
//
//   bun scripts/live/testnet.ts status
//   bun scripts/live/testnet.ts trade-limit-cancel      # step 1: GTC place + cancel as Trade owner
//   bun scripts/live/testnet.ts trade-open <sol>        # step 1: bounded IOC long as Trade owner
//   bun scripts/live/testnet.ts trade-close             # step 1: reduce-only close of the Trade position
//   bun scripts/live/testnet.ts approve-agent           # Hedge owner approves the server's hedge agent
//   bun scripts/live/testnet.ts arm <entry> <floor> <recovery> <ceiling> <maxSol> <minutes>
//   bun scripts/live/testnet.ts rule                    # rule view (signed-in as Hedge owner)
//   bun scripts/live/testnet.ts move-sol <sol> <to>     # step 4: move devnet SOL out of the watched wallet
//   bun scripts/live/testnet.ts close-rule              # owner-signed close
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { policyTypedData, type HedgePolicy } from "../../shared/policy";

const API = process.env.API_URL ?? "http://localhost:3001";
const env = Object.fromEntries(readFileSync(".env.testwallets", "utf8").split("\n")
  .filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const trade = privateKeyToAccount(env.TEST_TRADE_PRIVATE_KEY as Hex);
const hedge = privateKeyToAccount(env.TEST_HEDGE_PRIVATE_KEY as Hex);
const solana = Keypair.fromSeed(Uint8Array.from(Buffer.from(env.TEST_SOLANA_SECRET_SEED!, "hex")));
const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });
const devnet = new Connection("https://api.devnet.solana.com", "confirmed");

function evidence(step: string, data: unknown) {
  mkdirSync("docs/evidence", { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), env: "testnet", step, data },
    (_k, v) => typeof v === "bigint" ? v.toString() : v);
  appendFileSync("docs/evidence/testnet.jsonl", line + "\n");
  console.log(line);
}

async function api(path: string, body?: unknown, cookie?: string) {
  const res = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error} ${data.message}`);
  return { data, setCookie: res.headers.get("set-cookie") };
}

async function signIn(account: typeof hedge) {
  const { data } = await api("/api/session/challenge", { address: account.address });
  const { setCookie } = await api("/api/session/verify", { nonce: data.nonce, signature: await account.signMessage({ message: data.message }) });
  return setCookie!.split(";")[0]!;
}

async function sol() {
  const meta = await info.meta();
  const asset = meta.universe.findIndex(m => m.name === "SOL" && !m.isDelisted);
  const ctx = (await info.metaAndAssetCtxs())[1][asset]!;
  const book = await info.l2Book({ coin: "SOL" });
  return { asset, szDecimals: meta.universe[asset]!.szDecimals, mark: ctx.markPx,
    bid: book?.levels[0][0]?.px, ask: book?.levels[1][0]?.px };
}

// Prices: ≤5 significant figures and ≤ (6 − szDecimals) decimals.
function px(value: number, szDecimals: number, mode: "up" | "down") {
  const decimals = 6 - szDecimals;
  const digits = Math.floor(Math.log10(Math.abs(value))) + 1;
  const places = Math.max(0, Math.min(decimals, 5 - digits));
  const f = 10 ** places;
  return String((mode === "up" ? Math.ceil(value * f) : Math.floor(value * f)) / f);
}

async function positions(user: string) {
  const s = await info.clearinghouseState({ user });
  return { withdrawable: s.withdrawable, accountValue: s.marginSummary.accountValue,
    positions: s.assetPositions.map(p => ({ coin: p.position.coin, szi: p.position.szi, entryPx: p.position.entryPx })) };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "status") {
  const m = await sol();
  console.log(JSON.stringify({
    market: m,
    trade: { address: trade.address, ...await positions(trade.address), openOrders: await info.frontendOpenOrders({ user: trade.address }) },
    hedge: { address: hedge.address, ...await positions(hedge.address), openOrders: await info.frontendOpenOrders({ user: hedge.address }),
      agents: await info.extraAgents({ user: hedge.address }) },
    watched: { address: solana.publicKey.toBase58(), lamports: await devnet.getBalance(solana.publicKey) },
    health: (await api("/api/health")).data,
  }, null, 2));
}

if (cmd === "trade-limit-cancel") {
  const m = await sol();
  const ex = new ExchangeClient({ transport, wallet: trade });
  const price = px(Number(m.mark) * 0.8, m.szDecimals, "down"); // far below market: rests
  const cloid = `0x${crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}` as Hex;
  const placed = await ex.order({ orders: [{ a: m.asset, b: true, p: price, s: "0.2", r: false, t: { limit: { tif: "Gtc" } }, c: cloid }], grouping: "na" });
  const resting = await info.orderStatus({ user: trade.address, oid: cloid });
  const canceled = await ex.cancelByCloid({ cancels: [{ asset: m.asset, cloid }] });
  const after = await info.orderStatus({ user: trade.address, oid: cloid });
  evidence("step1.trade-limit-cancel", { account: trade.address, asset: m.asset, price, size: "0.2", cloid, placed, resting, canceled, after });
}

if (cmd === "trade-open") {
  const m = await sol();
  const ex = new ExchangeClient({ transport, wallet: trade });
  const limit = px(Number(m.ask ?? m.mark) * 1.01, m.szDecimals, "down"); // bounded IOC: 1% slippage
  const cloid = `0x${crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}` as Hex;
  const result = await ex.order({ orders: [{ a: m.asset, b: true, p: limit, s: args[0] ?? "0.2", r: false, t: { limit: { tif: "Ioc" } }, c: cloid }], grouping: "na" });
  evidence("step1.trade-open", { account: trade.address, limit, size: args[0] ?? "0.2", cloid, result,
    status: await info.orderStatus({ user: trade.address, oid: cloid }), position: await positions(trade.address) });
}

if (cmd === "trade-close") {
  const m = await sol();
  const ex = new ExchangeClient({ transport, wallet: trade });
  const pos = (await positions(trade.address)).positions.find(p => p.coin === "SOL");
  if (!pos || Number(pos.szi) === 0) throw new Error("No SOL position on the Trade account");
  const isLong = Number(pos.szi) > 0;
  const limit = px(Number(isLong ? m.bid : m.ask) * (isLong ? 0.99 : 1.01), m.szDecimals, isLong ? "up" : "down");
  const cloid = `0x${crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}` as Hex;
  const result = await ex.order({ orders: [{ a: m.asset, b: !isLong, p: limit, s: pos.szi.replace("-", ""), r: true, t: { limit: { tif: "Ioc" } }, c: cloid }], grouping: "na" });
  evidence("step1.trade-close", { account: trade.address, limit, cloid, result, position: await positions(trade.address) });
}

if (cmd === "approve-agent") {
  const { data: health } = await api("/api/health");
  const agentAddress = health.hedgeSigner?.agentAddress as Hex;
  if (!agentAddress) throw new Error("Server has no hedge signer");
  const validUntil = Date.now() + 2 * 86_400_000;
  const ex = new ExchangeClient({ transport, wallet: hedge });
  const result = await ex.approveAgent({ agentAddress, agentName: `baghedge valid_until ${validUntil}` });
  evidence("step3.approve-agent", { owner: hedge.address, agentAddress, signerKind: health.hedgeSigner.kind, validUntil, result,
    extraAgents: await info.extraAgents({ user: hedge.address }) });
}

if (cmd === "arm") {
  const [entry, floor, recovery, ceiling, maxSol, minutes] = args;
  const { data: draft } = await api("/api/hedges/draft", {
    tradeAddress: trade.address, hedgeAddress: hedge.address, solanaAddress: solana.publicKey.toBase58(),
    maxSol, entryMark: entry, entryFloor: floor, recoveryMark: recovery, exitCeiling: ceiling,
    expiresAt: Date.now() + Number(minutes) * 60_000,
  });
  const policy = draft.policy as HedgePolicy;
  const chainId = 421614; // owner wallet's chain for the Baghedge policy domain; any chain id works if consistent
  const ownerSig = await hedge.signTypedData(policyTypedData(policy, chainId));
  const { data: rule } = await api("/api/hedges", { policy, ownerSig, chainId });
  evidence("step3.arm", { ruleId: rule.id, policy, market: draft.market, phase: rule.phase, signerKind: rule.signerKind });
}

if (cmd === "rule") {
  const cookie = await signIn(hedge);
  const { data } = await api(`/api/hedges?hedge=${hedge.address.toLowerCase()}`, undefined, cookie);
  console.log(JSON.stringify(data, null, 2));
}

if (cmd === "move-sol") {
  const [amount, to] = args;
  const lamports = Math.round(Number(amount) * 1e9);
  const before = await devnet.getBalance(solana.publicKey);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: solana.publicKey, toPubkey: new PublicKey(to!), lamports }));
  const signature = await sendAndConfirmTransaction(devnet, tx, [solana], { commitment: "confirmed" });
  evidence("step4.move-sol", { from: solana.publicKey.toBase58(), to, lamports, signature, before, after: await devnet.getBalance(solana.publicKey) });
}

if (cmd === "close-rule") {
  const cookie = await signIn(hedge);
  const { data } = await api(`/api/hedges?hedge=${hedge.address.toLowerCase()}`, undefined, cookie);
  const rule = data.rules[0];
  if (!rule) throw new Error("No active rule");
  const issuedAt = Date.now(), chainId = 421614;
  const signature = await hedge.signTypedData({
    domain: { name: "Baghedge", version: "1", chainId },
    types: { HedgeCommand: [{ name: "ruleId", type: "bytes32" }, { name: "command", type: "string" }, { name: "issuedAt", type: "uint64" }] },
    primaryType: "HedgeCommand", message: { ruleId: rule.id, command: "close", issuedAt: BigInt(issuedAt) },
  });
  const { data: after } = await api(`/api/hedges/${rule.id}/close`, { signature, issuedAt, chainId });
  evidence("step5.close-rule", { ruleId: rule.id, phase: after.phase, reason: after.reason });
}
