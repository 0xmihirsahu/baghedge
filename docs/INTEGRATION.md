# Integrating the terminal with the Baghedge backend

**For:** the `terminal/` Next.js app.
**Goal:** replace the replay timers in `components/app/store.tsx` with real calls. Every endpoint below is live and tested against Hyperliquid, NEAR Intents, Solana and OutLayer. The exact request and response shapes are in [API.md](API.md).

> The backend holds no owner keys. Every owner action is signed in the user's wallet in the browser. The backend builds the payloads, checks the signatures, runs the hedge worker, and relays to Hyperliquid.

## 0. Setup

### Proxy `/api` to the backend (same origin)
Sign-in uses an `HttpOnly; SameSite=Lax` cookie, so the browser must reach the backend under the terminal's own origin. In `terminal/next.config.ts`:

```ts
const BACKEND = process.env.BAGHEDGE_API_URL!; // e.g. https://baghedge-api.onrender.com
export default {
  async rewrites() {
    return {
      // afterFiles: the terminal's own /api/balance keeps working
      afterFiles: ["health", "markets", "accounts", "wallet", "hedges", "session", "events", "transfers", "hl"]
        .map(p => ({ source: `/api/${p}/:path*`, destination: `${BACKEND}/api/${p}/:path*` }))
        .concat(["health", "markets", "accounts", "hedges", "session", "events"]
          .map(p => ({ source: `/api/${p}`, destination: `${BACKEND}/api/${p}` }))),
    };
  },
};
```
- In Vercel, set `BAGHEDGE_API_URL`.
- Set the backend's `APP_ORIGIN` to the terminal's https URL.
- Call everything as relative `/api/...`.

### Wallets
| Wallet | Used for | Library |
| --- | --- | --- |
| Phantom (Solana) | the watched address (read-only) | already in the app |
| **EVM wallet** (MetaMask, Rabby, phone via WalletConnect) | Hedge owner, Trade owner, Base funding | **add** `viem` + `wagmi` (or viem only) with WalletConnect |

WalletConnect project id: `3820d0c2a823fa021803a068e89059b5` (public; it's already in the backend env).

Gotchas:
- **Don't require Base in the WalletConnect session.** Pass chains as optional and use whatever chain the wallet approves. Requiring a chain causes `Missing or invalid. request() chainId`.
- Hedge-policy and command signatures work on **any** chain, as long as you send that chain's `chainId` with them.
- Only the Base USDC transfer needs chain 8453. Switch to it just before that one transaction.

### Signing a `typedData` from the API
Several endpoints return `typedData` (EIP-712, with uint64 values as decimal strings). Sign it as-is:
```ts
async function signTyped(wallet: WalletClient, account: `0x${string}`, typedData: any) {
  const { EIP712Domain, ...types } = typedData.types;
  return wallet.signTypedData({ account, domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
}
```

## 1. Sign in (needed to read hedge status)
```ts
const { message, nonce } = await post("/api/session/challenge", { address });
const signature = await wallet.signMessage({ account: address, message });
await post("/api/session/verify", { nonce, signature }); // sets the cookie
```
- Sign in as the **Hedge owner** to read the hedge.
- One session per browser; signing in again replaces it.
- `GET /api/session` returns the signed-in address.
- A `401 sign_in_required` means: run this again.

## 2. Fund an account from Base (Hedge or Trade)
```ts
const q = await post("/api/transfers/quote", { direction: "fund", role: "hedge", baseAddress, venueAddress: hedgeAddress, amount: "15", dry: false });
// Show the review: q.recipient, q.refundTo, q.amountIn (6 dec), q.minAmountOut (8 dec), q.deadline
await switchChain(8453);
const hash = await wallet.sendTransaction({ account: baseAddress, to: q.transfer.contract, data: q.transfer.data, value: 0n, chain: base });
await post(`/api/transfers/${q.id}/deposit`, { txHash: hash });
// Poll every few seconds until status is SUCCESS and recipientAccount.withdrawableUsdc > 0
const t = await get(`/api/transfers/${q.id}`);
```
UI states (section 12):
- `PENDING_DEPOSIT` → **Awaiting signature**
- `KNOWN_DEPOSIT_TX` → **Deposit detected**
- `PROCESSING` → **In transit**
- `SUCCESS` with `recipientAccount.withdrawableUsdc > 0` → **Credited**

Show **Credited** only when the second condition holds too.

- Use `dry: true` for display-only estimates. A dry quote is not a transfer.
- Mainnet only (Intents has no testnet). The verified run took about 90 seconds.

## 3. Approve the hedge agent (Hedge owner, once)
```ts
const { hedgeSigner } = await get("/api/health"); // { kind: "guard", agentAddress, buildHash }
const { action, typedData } = await post("/api/hl/approve-agent", { agentAddress: hedgeSigner.agentAddress, chainId, purpose: "hedge", validDays: 90 });
const signature = await signTyped(wallet, hedgeOwner, typedData);
await post("/api/hl/approve-agent/submit", { owner: hedgeOwner, action, signature });
```
- Hyperliquid only accepts this after the account has been funded (step 2).
- To check the agent is approved, read `extraAgents` for the Hedge address from Hyperliquid info.
- If `hedgeSigner.kind === "fallback"`, label it **Demo signer (not attested)**.

## 4. Arm the hedge (Hedge owner signs the policy)
```ts
const d = await post("/api/hedges/draft", {
  tradeAddress, hedgeAddress, solanaAddress, maxSol: "0.28",
  entryMark: "72.19", entryFloor: "70.75", recoveryMark: "74.36", exitCeiling: "75.08",
  expiresAt: Date.now() + 24 * 3600e3, chainId,
});
// Review: d.policy (show cap, prices, expiry), d.requiredMarginUsdc (must be ≤ the Hedge account's perps withdrawable)
const ownerSig = await signTyped(wallet, hedgeOwner, d.typedData);
const rule = await post("/api/hedges", { policy: d.policy, ownerSig, chainId });
```
Refusals to handle (all are HTTP 4xx with `{ error, message }`):

| `error` | What to show |
| --- | --- |
| `entry_already_crossed` | The price already passed the entry. Lower the entry and sign again. |
| `insufficient_margin` | Fund the Hedge account first. The message has both numbers. |
| `rule_active` | A hedge is already running on this account. |
| `hedge_account_busy` | The Hedge account has a position or orders. |
| `no_eligible_sol` | The watched wallet is empty. |
| `account_alias` | Trade and Hedge must be different accounts. |
| `invalid_policy` | The policy was edited after drafting, or signed by the wrong wallet. |

## 5. Live hedge status
```ts
const rule = await get(`/api/hedges?hedge=${hedgeAddress}`); // rules[0], needs a session
const es = new EventSource(`/api/events?rule=${rule.id}`);     // same-origin, the cookie is sent
es.onmessage = es.onerror = () => {};
["armed","reserved","order","stop","phase","paused","close","disarm","cancel-leftovers"].forEach(k =>
  es.addEventListener(k, () => refetchRule()));
```
Drive the UI from `rule.phase`, `rule.reason`, `rule.stopStatus`, `rule.shortLots` and `rule.pending`. The label table is in [API.md](API.md) under "Rule view". Rules:
- Show **Recovery stop active** only when `stopStatus === "active"`.
- An action with `transport: "unknown"` is **Checking order**, never filled.
- `shortLots` is in lots: SOL lots = 0.01 SOL, so `"28"` = 0.28 SOL.
- Fills are in `rule.fills`, with `tid`, `px`, `sz` and `fee`.

The worker resizes on its own. When the watched wallet drops below the short, it buys back the excess reduce-only (`pending.kind === "resize"` → **Buyback pending**).

## 6. Close or disarm (Hedge owner)
```ts
const c = await get(`/api/hedges/${rule.id}?command=close&chainId=${chainId}`); // or command=disarm
const signature = await signTyped(wallet, hedgeOwner, c.typedData);
await post(`/api/hedges/${rule.id}/close`, { signature, issuedAt: c.issuedAt, chainId });
```
- With an open short, the rule goes to `closing`, then `closed`.
- `reason: "cancelling-hedge-orders"` means the position is flat and the worker is clearing the leftover stop.
- `status: "done"` means finished.

## 7. Pay out to Base (Hedge or Trade owner)
```ts
const q = await post("/api/transfers/quote", { direction: "withdraw", role: "hedge", baseAddress, venueAddress: hedgeAddress, amount: "12", dry: false });
const { action, typedData } = await post(`/api/transfers/${q.id}/send-asset`, { chainId });
const signature = await signTyped(wallet, hedgeAddress, typedData);
await post(`/api/transfers/${q.id}/send-asset/submit`, { action, signature });
// Poll GET /api/transfers/:id until SUCCESS, then show the Base receipt
```
The relay only accepts a signature from the account being debited, and only to the quoted deposit address.

## 8. Manual Trade orders (Trade owner)
Wallets won't sign Hyperliquid's chain-1337 order payload directly. Use a **browser trading agent**:
1. Create a key in the tab (`generatePrivateKey()`) and keep it in `sessionStorage` (it can only trade).
2. Approve it once through the relay: `POST /api/hl/approve-agent` with `purpose: "trade"`, then `/submit` with `owner: tradeAddress`.
3. Sign orders with that key through `@nktkas/hyperliquid`:
```ts
const ex = new ExchangeClient({ transport: new HttpTransport(), wallet: privateKeyToAccount(agentKey) });
await ex.order({ orders: [{ a: asset, b: true, p: limitPx, s: size, r: false, t: { limit: { tif: "Ioc" } }, c: cloid }], grouping: "na" });
```
- Market order = bounded IOC (mark ± slippage).
- Limit = `Gtc`.
- Reduce and close = `r: true`.
- Read the asset id and `sizeDecimals` from `/api/markets`.
- Prices: at most 5 significant figures and at most `6 − sizeDecimals` decimals.
- Minimum $10 notional.

Query positions with the **Trade owner** address, not the agent. Verified on testnet: an agent approved through the relay placed and canceled an order on the owner's account.

## 9. Labels and copy (AGENTS.md rule 15)
- Keep the environment banner (Testnet / Mainnet).
- Label anything simulated as replay.
- Don't say lock, protect, insure or guarantee.
- Show pending items as pending.

## Endpoint cheat sheet
| Method | Path | Session? |
| --- | --- | --- |
| GET | `/api/health`, `/api/markets`, `/api/accounts?trade=&hedge=`, `/api/wallet/sol?address=` | no |
| POST | `/api/session/challenge`, `/api/session/verify`, `/api/session/signout` · GET `/api/session` | no |
| POST | `/api/transfers/quote` · GET `/api/transfers/:id` · POST `/api/transfers/:id/deposit` | no |
| POST | `/api/transfers/:id/send-asset`, `/api/transfers/:id/send-asset/submit` | no (signature-checked) |
| POST | `/api/hl/approve-agent`, `/api/hl/approve-agent/submit` | no (signature-checked) |
| POST | `/api/hedges/draft`, `/api/hedges` | no (policy signature) |
| GET | `/api/hedges?hedge=`, `/api/hedges/:id`, `/api/events?rule=` | **yes** |
| GET | `/api/hedges/:id?command=close\|disarm&chainId=` | no |
| POST | `/api/hedges/:id/close`, `/api/hedges/:id/disarm` | no (command signature) |

Live check of the whole API: `bun run smoke:api <backend-url>` (testnet).
