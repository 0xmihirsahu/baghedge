// Localhost-only owner console for verification runs. Runs in the browser; signs with the injected wallet.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
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

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
let account: Hex | null = null;
// The connected wallet: a browser extension (window.ethereum) or a phone wallet over WalletConnect.
let eth: Eip1193 | null = null;
let mode: "testnet" | "mainnet" = "testnet";
const wallet = () => {
  if (!eth || !account) throw new Error("Connect a wallet first");
  return createWalletClient({ account, transport: custom(eth) });
};
const chainId = async () => Number(await eth!.request({ method: "eth_chainId" }));
const exchange = () => new ExchangeClient({ transport: new HttpTransport({ isTestnet: mode === "testnet" }), wallet: wallet() });
const info = () => new InfoClient({ transport: new HttpTransport({ isTestnet: mode === "testnet" }) });

// Polyfills some WalletConnect dependencies expect in the browser.
(globalThis as Record<string, unknown>).global ??= globalThis;
(globalThis as Record<string, unknown>).process ??= { env: {} };

// Show any uncaught error on the page instead of failing silently.
const showError = (message: string) => {
  const box = document.getElementById("out-connect");
  if (box) box.textContent = `ERROR: ${message}`;
};
window.addEventListener("error", e => showError(e.message));
window.addEventListener("unhandledrejection", e => showError(String((e as PromiseRejectionEvent).reason)));

const OUTPUT_FOR: Record<string, string> = {
  "btn-wc": "out-connect", "btn-signin": "out-connect", "btn-connect": "out-connect",
  "btn-disarm": "out-rule", "btn-close": "out-rule",
  "btn-fund-quote": "out-fund", "btn-fund-send": "out-fund",
  "btn-payout-quote": "out-payout", "btn-payout-send": "out-payout",
};

function guard(id: string, fn: () => Promise<void>) {
  $(id).addEventListener("click", async () => {
    const out = OUTPUT_FOR[id] ?? id.replace(/^btn-/, "out-");
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
  if (!window.ethereum) throw new Error("No browser wallet found. Use 'Connect phone wallet (WalletConnect)'.");
  eth = window.ethereum;
  const [address] = await eth.request({ method: "eth_requestAccounts" }) as Hex[];
  account = address!.toLowerCase() as Hex;
  log("out-connect", { account, walletChainId: await chainId(), mode });
});

guard("btn-wc", async () => {
  const config = await fetch("/ops/config.json").then(r => r.json());
  if (!config.walletConnectProjectId) throw new Error("Set WALLETCONNECT_PROJECT_ID in the env file and restart the backend");
  // No required chains: some wallets reject or narrow required namespaces. Use whatever the wallet approves.
  const provider = await EthereumProvider.init({
    projectId: config.walletConnectProjectId, showQrModal: true,
    optionalChains: [8453, 1, 42161, 10, 137],
    methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_chainId", "wallet_switchEthereumChain"],
    metadata: { name: "Baghedge ops", description: "Owner console", url: location.origin, icons: [] },
  });
  await provider.connect();
  // Send requests on a chain the wallet actually approved, else every request fails with "Missing or invalid chainId".
  const approved = (provider.session?.namespaces?.eip155?.chains ?? [])
    .map((c: string) => Number(c.split(":")[1])).filter((n: number) => Number.isSafeInteger(n));
  if (approved.length && !approved.includes(provider.chainId)) {
    const target = approved.includes(8453) ? 8453 : approved[0]!;
    // For a chain already in the session, the provider switches locally without a wallet prompt.
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${target.toString(16)}` }] });
  }
  eth = provider as unknown as Eip1193;
  const [address] = await eth.request({ method: "eth_accounts" }) as Hex[];
  account = address!.toLowerCase() as Hex;
  log("out-connect", { account, walletChainId: await chainId(), approvedChains: approved, mode, via: "WalletConnect" });
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
  if (await chainId() !== base.id) await eth!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  const hash = await createWalletClient({ account: account!, chain: base, transport: custom(eth!) }).writeContract({
    address: quote.transfer.contract, abi: erc20Abi, functionName: "transfer", args: [quote.transfer.to, BigInt(quote.transfer.amount)],
  });
  const submitted = await api(`/api/transfers/${quote.id}/deposit`, { txHash: hash }).catch(e => ({ error: String(e) }));
  ($("transfer-id") as HTMLInputElement).value = quote.id;
  log("out-fund", { baseTx: hash, transferId: quote.id, intentsNotified: submitted,
    next: "Use 'Check transfer' until SUCCESS; recipientAccount shows the credited Hyperliquid balance" });
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
