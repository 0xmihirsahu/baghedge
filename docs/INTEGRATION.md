# Integrating the terminal with the Baghedge backend

**Backends:**
- **Production (mainnet):** https://baghedge-api-mainnet.onrender.com, with the attested OutLayer guard, executable NEAR Intents quotes and real funds. Set it as `BAGHEDGE_API_URL` for the Vercel **production** environment.
- **Sandbox (testnet):** https://baghedge-api.onrender.com, with the labeled demo signer and dry quotes only. Use it for Vercel **preview** and local development.
- Check `GET /api/health` → `mode` and `hedgeSigner.kind`.

**For:** the `terminal/` Next.js app.
**Goal:** replace the replay timers in `components/app/store.tsx` with real calls. Every endpoint below is live and tested against Hyperliquid, NEAR Intents, Solana and OutLayer. The exact request and response shapes are in [API.md](API.md).

> **Wallets:** Privy embedded Trade and Hedge wallets, external wallets as the fallback, Phantom read-only (see 0 → Wallets).

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
const BACKEND = process.env.BAGHEDGE_API_URL!; // prod: https://baghedge-api-mainnet.onrender.com · preview: https://baghedge-api.onrender.com
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

### Wallets: Privy (decided)
**Decision:** use **Privy** for login, with **two embedded EVM wallets** (Trade and Hedge) per user. **External wallets** (MetaMask, Rabby, WalletConnect) are the fallback, and **Phantom** stays the watched SOL wallet (read-only). The backend needs no changes: it only verifies EIP-712 signatures, whichever wallet makes them.

| Role | Wallet | Signs |
| --- | --- | --- |
| Login | Privy: email, Google or wallet | — |
| **Trade owner** | Privy embedded EVM wallet, **index 0** | trading-agent approval (once), Trade payout |
| **Hedge owner** | Privy embedded EVM wallet, **index 1** | guard-agent approval, hedge policy, close or disarm, Hedge payout, hedge sign-in |
| Watched SOL | **Phantom** (external), linked or pasted | nothing: only its address is read |
| Base funding source | an external wallet holding Base USDC (MetaMask, Coinbase Wallet, Phantom's EVM account…) | one USDC transfer per funding. Embedded wallets never need to hold tokens or gas, because funds land directly in the Hyperliquid account. |

Trade and Hedge **must be different addresses** (AGENTS.md rule 8). Index 0 and index 1 always are.

#### Setup
```sh
cd terminal && bun add @privy-io/react-auth
```
- Vercel env: `NEXT_PUBLIC_PRIVY_APP_ID`.
- Privy dashboard: add `https://app.baghedge.xyz` and `http://localhost:3000` to allowed origins.
- Enable email, Google and wallet login.

```tsx
// terminal/components/app/privy.tsx
"use client";
import { PrivyProvider } from "@privy-io/react-auth";

export function Wallets({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false }, // our own confirm screens
        appearance: { walletChainType: "ethereum-and-solana" },                          // lets users link Phantom
        walletConnectCloudProjectId: "3820d0c2a823fa021803a068e89059b5",                  // external-wallet fallback
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

#### Map wallets to roles
```tsx
import { useCreateWallet, useWallets } from "@privy-io/react-auth";

export function useAccountsFromPrivy() {
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  // createWallet({ walletIndex }) returns the existing wallet when that index already exists, so this is safe every session.
  const ensureHedge = () => createWallet({ walletIndex: 1 });
  const embedded = wallets.filter(w => w.walletClientType === "privy");
  return { embedded, ensureHedge };
}
```
- Store the two addresses after first login: Trade is the index-0 wallet and Hedge is the index-1 wallet returned by `ensureHedge()`.
- Pick wallets **by address** afterwards. Privy's React wallet objects don't expose `walletIndex`.

#### Sign API payloads with an embedded wallet
Every `typedData` from our API can be passed straight to Privy:
```tsx
import { useSignMessage, useSignTypedData } from "@privy-io/react-auth";

const { signTypedData } = useSignTypedData();
const { signMessage } = useSignMessage();

// policy, HedgeCommand, approveAgent, sendAsset: pick the owner address; confirm in our UI first
const { signature } = await signTypedData(typedData, { address: hedgeAddress, uiOptions: { showWalletUIs: false } });

// session sign-in (section 1)
const { signature: login } = await signMessage({ message }, { address: hedgeAddress, uiOptions: { showWalletUIs: false } });
```
Security rules:
- **Payouts keep a visible confirm** (`showWalletUIs: true` for `sendAsset`), and show the exact amount and destination.
- Show our own confirm screen with the exact policy values before every silent signature.
- Keep Hedge margin modest, and serve a strict CSP. Silent signing means a compromised page could request signatures.

#### Test these first (≈1 h, mainnet-safe)
1. Embedded Hedge wallet: `/api/session/challenge` → `signMessage` → `/verify`, giving a cookie.
2. Draft → `signTypedData(d.typedData)` → `POST /api/hedges`. Use an entry far below market, then disarm with a signed HedgeCommand.
3. `POST /api/hl/approve-agent` (trade) → `signTypedData` → `/submit` → `extraAgents` lists it.
4. **Optional:** can the embedded Trade wallet sign Hyperliquid **order** payloads directly (chainId 1337)? If yes, the trading-agent step (section 8) disappears. If not, keep the agent.

#### Fallback: external wallets
Users who prefer their own wallets log in with `"wallet"` (MetaMask, Rabby, Coinbase Wallet or WalletConnect) and **must connect two different addresses**, one for Trade and one for Hedge. The signing code is the same: pass `address`. Gotchas:
- **Don't require Base in the WalletConnect session.** Pass chains as optional. Requiring one causes `Missing or invalid. request() chainId`.
- Policy and command signatures work on **any** chain, as long as you send that chain's `chainId`.
- Only the Base USDC transfer needs chain 8453.
- MetaMask won't sign Hyperliquid order payloads (chainId 1337), so external-wallet users always use the trading agent (section 8).

#### Watched wallet (Phantom)
Keep the existing Solana wallet adapter, or link Phantom through Privy. Either way, only the **address** goes to the backend (`solanaAddress` in the draft, and `/api/wallet/sol?address=`). No signature is needed.

### Signing a `typedData` with viem (external wallets)
With Privy, pass `typedData` to `signTypedData` as shown above. With a raw viem wallet client:
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
With Privy, `venueAddress` is the user's **embedded** Trade or Hedge address. `baseAddress` is the **external** source wallet on the funding chain (for example Phantom for SOL, or a wallet holding Base USDC): it sends the transfer and receives any refund. The embedded wallets never need tokens or gas.
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
const t = await get(`/api/transfers/${q.id}`);                   // poll every few seconds until SUCCESS and recipientAccount.usableUsdc > 0
```
UI states (section 12):
- `PENDING_DEPOSIT` → **Awaiting signature**
- `KNOWN_DEPOSIT_TX` → **Deposit detected**
- `PROCESSING` → **In transit**
- `SUCCESS` with `recipientAccount.usableUsdc > 0` → **Credited**

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

## Fees and gas (show these before the user signs)

Measured on the mainnet run (Nov 14). Users **never need gas on Hyperliquid or NEAR**. With Privy, the embedded Trade and Hedge wallets only sign and never pay gas.

| Step | Who pays | What it costs | Where to show it |
| --- | --- | --- | --- |
| Funding transfer (source token → deposit address) | User: gas on the source chain, from the funding wallet (ETH on Base or other EVM chains, SOL on Solana) | under $0.01 on Base or Solana | Fund screen ("network fee") |
| NEAR Intents route Base → Hyperliquid | User, taken from the amount | about $0.32 on $6–15 (`amountIn` − `amountOut` in the quote) | Fund review: show `amountIn`, `amountOut`, `minAmountOut` |
| First deposit into a new Hyperliquid account | User, in USDC | 1 USDC (activation) | Fund review, first time only |
| Orders (manual, hedge entry, buyback, close) | The trading account, in USDC | 0.045% taker per fill (~$0.005–0.01 on a $10–20 order); no gas | Ticket and hedge review |
| Guard signature per hedge order | **Baghedge (operator)**, NEAR on the executor account | ~0.002 NEAR (~$0.006) per signature; ~3 per hedge cycle | Not shown to users (an operator cost) |
| Payout `sendAsset` from Hyperliquid | User, in USDC | 1 USDC (seen when sending to the quote's deposit address) | Payout review: **leave ≥ 1.2 USDC** in the account, or the transfer fails with "Insufficient USDC balance for token transfer gas" |
| NEAR Intents route Hyperliquid → Base | User, taken from the amount | about 0.2 USDC (13.5 → 13.297) | Payout review |
| Signatures (policy, commands, sign-in, agent approvals) | Nobody | free (off-chain) | — |
| Funding rate on open positions | The position holder | hourly, variable (`fundingRate` in `/api/markets`) | Hedge review: "variable funding" |

**UI rules:**
- **Payout max** = `maxPayoutUsdc` from `/api/accounts` (usable − 1.2 USDC). Pre-fill that rather than the full balance.
- Show the **required margin** (`requiredMarginUsdc` from the draft) next to the costs, and label it as margin that comes back, not a fee.
- Label every quote number as an estimate until the transfer reaches `SUCCESS`.

**Operator side** (not for the UI):
- The executor account pays every guard call; 1 NEAR covers about 500.
- Monitor its balance with an alert, and top it up.
- The worker pauses a rule after 3 failed guard calls, so a broken guard can't drain it.
- Hyperliquid builder codes (brief §4) can add a small disclosed per-order fee to cover guard gas and hosting.

## Fewer wallets and signatures

Our end-to-end mainnet run took **4 wallets** (Trade EVM, Hedge EVM, Base funding, Phantom) and about **11 prompts**. This is how to get a user down to **one or two wallets and about 3 prompts for the whole lifecycle**.

### What's already in the backend
- **Fund from the wallet the user already has.** Phantom users fund with SOL or Solana USDC, so there's no Base wallet and no ETH for gas (section 2).
- **The watched wallet is read-only.** Phantom only needs to share its address, with no signature. A "you control this" badge is optional.
- **One trading-agent approval** covers manual trading for up to 180 days (`validDays: 180`).

### Recommended: Privy
See **0 → Wallets: Privy (decided)**: one login, separate embedded Trade and Hedge addresses, Phantom read-only, in-app confirms with a visible confirm for payouts. Don't derive a Hedge key from a wallet signature: that signature would be a bearer secret able to withdraw principal.

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
