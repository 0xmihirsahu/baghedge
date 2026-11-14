// Localhost-only owner console for verification runs. Runs in the browser; signs with the injected wallet.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { createWalletClient, custom, erc20Abi, type Hex } from "viem";
import { base } from "viem/chains";
import { policyTypedData, type HedgePolicy } from "../../shared/policy";

const $ = (id: string) => document.getElementById(id)!;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
const log = (id: string, value: unknown) => {
  $(id).textContent = typeof value === "string" ? value : JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2);
};
const api = async (path: string, body?: unknown) => {
  const res = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${data.error}: ${data.message}`);
  return data;
};

declare global { interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } } }

let account: Hex | null = null;
let mode: "testnet" | "mainnet" = "testnet";
const wallet = () => {
  if (!window.ethereum || !account) throw new Error("Connect a wallet first");
  return createWalletClient({ account, transport: custom(window.ethereum) });
};
const chainId = async () => Number(await window.ethereum!.request({ method: "eth_chainId" }));
const exchange = () => new ExchangeClient({ transport: new HttpTransport({ isTestnet: mode === "testnet" }), wallet: wallet() });
const info = () => new InfoClient({ transport: new HttpTransport({ isTestnet: mode === "testnet" }) });

function guard(id: string, fn: () => Promise<void>) {
  $(id).addEventListener("click", async () => {
    const out = id.replace(/^btn-/, "out-");
    log(out, "working… check your wallet");
    try { await fn(); } catch (error) { log(out, `ERROR: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

async function boot() {
  const health = await api("/api/health");
  mode = health.mode;
  $("env").textContent = mode.toUpperCase();
  $("env").className = `env ${mode}`;
  log("signer", health.hedgeSigner ?? "no hedge signer configured");
  if (health.hedgeSigner) ($("agent") as HTMLInputElement).value = health.hedgeSigner.agentAddress;
  ($("expires") as HTMLInputElement).value = String(Date.now() + 60 * 60_000);
}

guard("btn-connect", async () => {
  const [address] = await window.ethereum!.request({ method: "eth_requestAccounts" }) as Hex[];
  account = address!.toLowerCase() as Hex;
  log("out-connect", { account, walletChainId: await chainId(), mode });
});

guard("btn-signin", async () => {
  const challenge = await api("/api/session/challenge", { address: account });
  const signature = await wallet().signMessage({ message: challenge.message });
  log("out-connect", await api("/api/session/verify", { nonce: challenge.nonce, signature }));
});

guard("btn-agents", async () => {
  if (!account) throw new Error("Connect first");
  log("out-agents", { owner: account, agents: await info().extraAgents({ user: account }) });
});

guard("btn-approve", async () => {
  const validUntil = Date.now() + Number(val("agent-days")) * 86_400_000;
  // The timestamp unit is an open check (section 32 #8): we send ms and read it back from extraAgents.
  const agentName = `baghedge valid_until ${validUntil}`;
  const result = await exchange().approveAgent({ agentAddress: val("agent") as Hex, agentName });
  const agents = await info().extraAgents({ user: account! });
  log("out-approve", { sent: { agentAddress: val("agent"), agentName }, result, extraAgentsAfter: agents });
});

guard("btn-arm", async () => {
  const draft = await api("/api/hedges/draft", {
    tradeAddress: val("trade"), hedgeAddress: account, solanaAddress: val("solana"), maxSol: val("max"),
    entryMark: val("entry"), entryFloor: val("floor"), recoveryMark: val("recovery"), exitCeiling: val("ceiling"),
    expiresAt: Number(val("expires")),
  });
  const policy = draft.policy as HedgePolicy;
  const id = await chainId();
  log("out-arm", { reviewing: policy, market: draft.market, signerKind: draft.signerKind, chainId: id });
  const ownerSig = await wallet().signTypedData(policyTypedData(policy, id));
  log("out-arm", await api("/api/hedges", { policy, ownerSig, chainId: id }));
});

guard("btn-rule", async () => {
  const data = await api(`/api/hedges?hedge=${account}`);
  log("out-rule", data.rules.length ? data.rules : "no active rule for this Hedge account");
});

async function command(kind: "disarm" | "close") {
  const data = await api(`/api/hedges?hedge=${account}`);
  const rule = data.rules[0];
  if (!rule) throw new Error("No active rule");
  const issuedAt = Date.now();
  const id = await chainId();
  const signature = await wallet().signTypedData({
    domain: { name: "Baghedge", version: "1", chainId: id },
    types: { HedgeCommand: [{ name: "ruleId", type: "bytes32" }, { name: "command", type: "string" }, { name: "issuedAt", type: "uint64" }] },
    primaryType: "HedgeCommand", message: { ruleId: rule.id, command: kind, issuedAt: BigInt(issuedAt) },
  });
  log("out-rule", await api(`/api/hedges/${rule.id}/${kind}`, { signature, issuedAt, chainId: id }));
}
guard("btn-disarm", () => command("disarm"));
guard("btn-close", () => command("close"));

guard("btn-fund-quote", async () => {
  const quote = await api("/api/transfers/quote", {
    direction: "fund", role: val("fund-role"), baseAddress: account, venueAddress: val("fund-venue"), amount: val("fund-amount"), dry: false,
  });
  (window as unknown as Record<string, unknown>).fundQuote = quote;
  log("out-fund", { review: { from: account, depositAddress: quote.depositAddress, recipient: quote.recipient, refundTo: quote.refundTo,
    amountIn: quote.amountIn, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, deadline: quote.deadline }, id: quote.id });
});

guard("btn-fund-send", async () => {
  const quote = (window as unknown as Record<string, any>).fundQuote;
  if (!quote?.transfer || quote.transfer.type !== "baseErc20Transfer") throw new Error("Get an executable fund quote first");
  if (Date.parse(quote.deadline) <= Date.now()) throw new Error("Quote deadline passed; get a new quote");
  if (await chainId() !== base.id) await window.ethereum!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  const hash = await createWalletClient({ account: account!, chain: base, transport: custom(window.ethereum!) }).writeContract({
    address: quote.transfer.contract, abi: erc20Abi, functionName: "transfer", args: [quote.transfer.to, BigInt(quote.transfer.amount)],
  });
  log("out-fund", { baseTx: hash, transferId: quote.id, next: "Use 'Check transfer' until SUCCESS, then confirm margin on Hyperliquid" });
});

guard("btn-payout-quote", async () => {
  const quote = await api("/api/transfers/quote", {
    direction: "withdraw", role: "hedge", baseAddress: val("payout-base"), venueAddress: account, amount: val("payout-amount"), dry: false,
  });
  (window as unknown as Record<string, unknown>).payoutQuote = quote;
  log("out-payout", { review: { fromHedge: account, depositAddress: quote.depositAddress, baseRecipient: quote.recipient,
    amountIn: quote.amountIn, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, deadline: quote.deadline }, id: quote.id });
});

guard("btn-payout-send", async () => {
  const quote = (window as unknown as Record<string, any>).payoutQuote;
  if (!quote?.transfer || quote.transfer.type !== "hypercoreSendAsset") throw new Error("Get an executable payout quote first");
  if (Date.parse(quote.deadline) <= Date.now()) throw new Error("Quote deadline passed; get a new quote");
  const t = quote.transfer;
  const result = await exchange().sendAsset({
    destination: t.destination, sourceDex: t.sourceDex, destinationDex: t.destinationDex, token: t.token, amount: t.amount, fromSubAccount: t.fromSubAccount,
  });
  log("out-payout", { sendAsset: result, transferId: quote.id });
});

guard("btn-transfer", async () => {
  log("out-transfer", await api(`/api/transfers/${val("transfer-id")}`));
});

void boot();
