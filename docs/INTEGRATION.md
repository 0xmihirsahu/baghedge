# Integrating the terminal with the Baghedge backend

**Backend:** https://baghedge-api.onrender.com. It currently runs **testnet** with the labeled demo signer, and switches to mainnet with the attested guard after the current mainnet hedge cycle. Check `GET /api/health` → `mode` and `hedgeSigner.kind`.

**For:** the `terminal/` Next.js app.
**Goal:** replace the replay timers in `components/app/store.tsx` with real calls. Every endpoint below is live and tested against Hyperliquid, NEAR Intents, Solana and OutLayer. The exact request and response shapes are in [API.md](API.md).

> The backend holds no owner keys. Every owner action is signed in the user's wallet in the browser. The backend builds the payloads, checks the signatures, runs the hedge worker, and relays to Hyperliquid.

## What's supported

| Area | Supported today | Notes |
| --- | --- | --- |
| **Manual trading (Trade account)** | **All 179 live Hyperliquid perps** (BTC, ETH, SOL, HYPE, memes, and more) | Read the list, asset ids and `sizeDecimals` from `GET /api/markets`. Orders are signed in the browser by the trading agent (section 8), so any perp works. `k`-prefixed markets (`kPEPE`, `kBONK`, `kSHIB`) are quoted per **1000 tokens**. |
| **Funding in (to Trade or Hedge)** | **Any of the ~228 tokens on 38 chains** that NEAR Intents lists, converted to Hyperliquid USDC. Examples: USDC on Base, Arbitrum, Ethereum, Optimism, Polygon, BSC or Solana; native **SOL**, **ETH** (mainnet, Base, Arbitrum) and NEAR. | `GET /api/transfers/assets` lists them. Pass `externalAsset: <assetId>` to `/api/transfers/quote`. Dry quotes for all the examples returned 30–60 s routes (Nov 14). Live-funded so far: Base USDC. |
| **Pay out** | The same list in reverse: Hyperliquid USDC → any listed token or chain | `direction: "withdraw"` with `externalAsset`, and `baseAddress` = the recipient on that chain. |
| **Wallet Hedge (watched asset)** | **SOL** held liquid in a Solana wallet | The worker, policy and guard are SOL-only today (see below). |
| **Margin asset** | Hyperliquid perps **USDC** | Unified accounts hold USDC in spot (`spotUsdc`). See section 2. |

### Hedging more than SOL
The hedge logic is market-generic: sizes and prices use each market's own `sizeDecimals`, and the signed policy already carries `market` and `assetId`. It's SOL-only today because of four things:
1. the worker reads only native SOL balances;
2. `shared/policy.ts` and the Rust guard accept only `market: "SOL"`;
3. the guard build pins one asset id;
4. `COIN = "SOL"` in the worker.

Any token that **sits in a wallet we can read** and **has a Hyperliquid perp** can be added. Candidates from today's lists:

| Wallet chain | Tokens with a Hyperliquid perp |
| --- | --- |
| Solana | SOL ✅ (live), TRUMP, PENGU, BOME, MELANIA, SPX, TURBO, ZEC, STRK, NEAR (bridged), plus LSTs (JitoSOL, mSOL) counted as SOL |
| Ethereum / Base / Arbitrum / Optimism / Polygon | ETH (native, every chain), BTC (WBTC, cbBTC), LINK, UNI, AAVE, ARB, OP, GMX, POL, kPEPE, kSHIB, BRETT, KAITO, VVV |
| Other | BNB, AVAX, SUI, APT, XRP, TRX, DOGE, LTC, ADA, NEAR |

What each new asset needs:
- a balance reader for its chain (an SPL token account or an ERC-20 `balanceOf`), in raw units;
- unit conversion for `k` markets (1 lot of `kPEPE` = 1000 PEPE);
- a guard build pinned to that market, or a guard that accepts a list of markets.

ETH and BTC on EVM chains are the highest-value next step.

## 0. Setup

### Proxy `/api` to the backend (same origin)
Sign-in uses an `HttpOnly; SameSite=Lax` cookie, so the browser must reach the backend under the terminal's own origin. In `terminal/next.config.ts`:

```ts
const BACKEND = process.env.BAGHEDGE_API_URL!; // https://baghedge-api.onrender.com (live, testnet for now)
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

## 2. Fund an account (from any chain)
```ts
const { assets } = await get("/api/transfers/assets");        // pick one: e.g. SOL on Solana, USDC on Arbitrum
const q = await post("/api/transfers/quote", {
  direction: "fund", role: "hedge", venueAddress: hedgeAddress, amount: "0.2", dry: false,
  externalAsset: "nep141:sol.omft.near",                         // omit for Base USDC (the default)
  baseAddress: phantomAddress,                                    // the source wallet on that chain (refunds go here)
});
// Show the review: q.externalAsset, q.recipient, q.refundTo, q.amountIn (source decimals), q.minAmountOut (8 dec), q.deadline
```
Then send `q.transfer` from the source wallet. Its `type` says how:

| `transfer.type` | Send with |
| --- | --- |
| `baseErc20Transfer` / `evmErc20Transfer` | EVM wallet on `chainId`: `{ to: contract, data, value: 0 }` |
| `evmNativeTransfer` | EVM wallet on `chainId`: `{ to, value }` (native ETH and similar) |
| `solanaTransfer` | Phantom: `SystemProgram.transfer` of `amount` lamports to `to` when `mint` is null, otherwise an SPL transfer of `mint` |
| `deposit` | Any other chain: send `amount` of the asset to `to`, including `memo` if one is set |

```ts
await post(`/api/transfers/${q.id}/deposit`, { txHash });       // optional speed-up
const t = await get(`/api/transfers/${q.id}`);                   // poll every few seconds until SUCCESS and recipientAccount.withdrawableUsdc > 0
```
UI states (section 12):
- `PENDING_DEPOSIT` → **Awaiting signature**
- `KNOWN_DEPOSIT_TX` → **Deposit detected**
- `PROCESSING` → **In transit**
- `SUCCESS` with `recipientAccount.withdrawableUsdc > 0` → **Credited**

Show **Credited** only when the second condition holds too.

- Use `dry: true` for display-only estimates.
- Mainnet only (Intents has no testnet).
- Fees seen live: 1Click about 0.2 USDC, Hyperliquid activation 1 USDC on a new account, and 1 USDC on `sendAsset` payouts.
- Keep about 1.2 USDC in an account when paying out everything.

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

## 7. Pay out (to Base or any listed chain; Hedge or Trade owner)
```ts
const q = await post("/api/transfers/quote", { direction: "withdraw", role: "hedge", baseAddress: recipientOnThatChain, venueAddress: hedgeAddress, amount: "12", dry: false /* , externalAsset: any listed asset; default Base USDC */ });
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

## Fewer wallets and signatures

Our end-to-end mainnet run took **4 wallets** (Trade EVM, Hedge EVM, Base funding, Phantom) and about **11 prompts**. This is how to get a user down to **one or two wallets and about 3 prompts for the whole lifecycle**.

### What's already in the backend
- **Fund from the wallet the user already has.** Phantom users fund with SOL or Solana USDC, so there's no Base wallet and no ETH for gas (section 2).
- **Arming signs you in.** A successful `POST /api/hedges` sets the session cookie for the Hedge owner, so no separate sign-in is needed after arming.
- **The watched wallet is read-only.** Phantom only needs to share its address, with no signature. A "you control this" badge is optional.
- **One trading-agent approval** covers manual trading for up to 180 days (`validDays: 180`).

### Recommended: separate addresses behind one wallet interface (Privy)
Don't derive the Hedge key from a wallet signature. That signature would be a bearer secret that can withdraw principal, and keeping it in the browser removes wallet confirmation. Use **separate wallet addresses under one login** instead:

| Account | With Privy |
| --- | --- |
| Trade owner | The user's embedded EVM wallet |
| Hedge owner | A second embedded wallet under the same login (`createWallet({ createAdditional: true })`) |
| Watched SOL | The user's own Phantom, linked or pasted, read-only |
| Funding | One Phantom (or other) transfer through NEAR Intents straight into the Hyperliquid account. The embedded wallets never hold tokens or gas. |

- Keys stay in Privy's infrastructure, not in our JavaScript.
- Privy handles recovery and export.
- Privy's prompts can be replaced by your own confirm screens. **Keep an explicit confirm for payouts**, and keep Hedge margin modest.
- Tradeoffs: you trust Privy's key infrastructure; it's priced per monthly active user; and wallets are app-scoped, so a Privy address here differs from the user's address on hyperliquid.xyz.
- Verify before relying on them:
  - typed-data signing for the Baghedge policy and Hyperliquid user-signed actions with Privy embedded wallets;
  - whether embedded wallets can sign Hyperliquid order payloads directly, which would remove the trading-agent step.

### Guard scope (unchanged for now)
The current guard build **pins one Hedge owner address** at build time, so each Hedge owner needs its own guard build and attestation. Serving many owners from one build would need a verified per-owner key namespace and venue-approval isolation. That's a future design item, not a drop-in change.

## 9. Labels and copy (AGENTS.md rule 15)
- Keep the environment banner (Testnet / Mainnet).
- Label anything simulated as replay.
- Don't say lock, protect, insure or guarantee.
- Show pending items as pending.

## Endpoint cheat sheet
| Method | Path | Session? |
| --- | --- | --- |
| GET | `/api/health`, `/api/markets`, `/api/accounts?trade=&hedge=`, `/api/wallet/sol?address=`, `/api/transfers/assets` | no |
| POST | `/api/session/challenge`, `/api/session/verify`, `/api/session/signout` · GET `/api/session` | no |
| POST | `/api/transfers/quote` · GET `/api/transfers/:id` · POST `/api/transfers/:id/deposit` | no |
| POST | `/api/transfers/:id/send-asset`, `/api/transfers/:id/send-asset/submit` | no (signature-checked) |
| POST | `/api/hl/approve-agent`, `/api/hl/approve-agent/submit` | no (signature-checked) |
| POST | `/api/hedges/draft`, `/api/hedges` | no (policy signature) |
| GET | `/api/hedges?hedge=`, `/api/hedges/:id`, `/api/events?rule=` | **yes** |
| GET | `/api/hedges/:id?command=close\|disarm&chainId=` | no |
| POST | `/api/hedges/:id/close`, `/api/hedges/:id/disarm` | no (command signature) |

Live check of the whole API: `bun run smoke:api <backend-url>` (testnet).
