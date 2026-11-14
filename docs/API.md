# Baghedge backend API

This is the contract between the terminal (browser) and the Bun backend. All amounts and prices are decimal strings, and every bigint is sent as a string. The backend never holds owner keys.

**Who sends what**
- **Manual Trade orders** go from the browser straight to Hyperliquid through `@nktkas/hyperliquid`. The backend isn't involved.
- **Hedge orders** are sent by the backend worker, signed by the approved hedge agent.
- **Owner signatures** (agent approval, hedge policy, disarm/close, Base transfer, payout `sendAsset`) are made in the browser wallet.

**Signing L1 actions from the browser.** For manual Trade orders, an EIP-712 domain with chainId 1337 doesn't match the wallet's active chain, and MetaMask refuses to sign it. Use the SDK's browser-wallet guidance: have the owner approve a short-lived browser agent, then sign orders with that agent. User-signed actions (`approveAgent`, `sendAsset`) sign on the wallet's current chain, so those work as is.

Base path: `/api`. `401 sign_in_required` means: run the sign-in flow below. Errors are `{ error: <code>, message }` with an HTTP status.

## Status

### `GET /api/health`
```json
{ "mode": "testnet", "executableQuotesEnabled": false, "workerRunning": true,
  "hedgeSigner": { "kind": "fallback" | "guard", "agentAddress": "0x…", "buildHash": "0x…" } | null }
```
- If `hedgeSigner.kind` is `"fallback"`, show **"Demo signer (not attested)"** in the UI.
- Approve `hedgeSigner.agentAddress` as an agent on the Hedge account. Don't approve any other address.

### `GET /api/markets`, `GET /api/accounts?trade=&hedge=`, `GET /api/wallet/sol?address=`
Each account in `/api/accounts` also includes:
- `spotUsdc: { total, hold } | null` (null when the spot read failed);
- **`accountMode: "standard" | "unified" | "unknown"`**: `unknown` (with `usableUsdc`/`maxPayoutUsdc` null) means the margin read failed. The rest of the account still loads; show "margin unavailable".
- **`usableUsdc`**: the margin to show. On standard accounts that's perps `withdrawable`; on unified accounts, Hyperliquid keeps USDC in spot and backs perps with it, so it's the spot USDC available after maintenance.
- **`maxPayoutUsdc`**: `usableUsdc` − 1.2, leaving room for the 1 USDC `sendAsset` fee. Use it as the payout maximum. On a Hyperliquid unified account, USDC sits in spot and backs perps margin, so `withdrawableUsdc` (perps) can read 0 while the account is funded. Show both values, and label which one is usable for the account's mode.

## Hedge rules

### 0. `GET /api/hedges/agent?owner=<Hedge address>`: the agent to approve
Returns `{ owner, agentAddress, signerKind, buildHash, multiOwner }`. On a multi-owner guard build, each Hedge owner has their **own** agent: approve this address (section 3 of the integration guide) before arming. Error `owner_unsupported` means this server's guard can't sign for that account.

### 1. `POST /api/hedges/draft`: build the policy for review
Request:
```json
{ "tradeAddress": "0x…", "hedgeAddress": "0x…", "solanaAddress": "<base58>",
  "maxSol": "0.4", "entryMark": "70", "entryFloor": "68.6", "recoveryMark": "80.5", "exitCeiling": "82",
  "expiresAt": 1794700000000 }
```
Optional: include `"chainId": <the wallet's current chain id>` in the request to get a ready-to-sign payload back.

Response: `{ policy, signerKind, market: { asset, sizeDecimals, markPx, maxLeverage }, requiredMarginUsdc, typedData }`.
- `requiredMarginUsdc` is the perps margin the Hedge account must hold to arm: the loss from floor to ceiling, maintenance, fees and a 5% buffer. It's signed into the policy as `minMarginE6`. Show it before funding.
- `typedData` (only when `chainId` was sent) is the exact EIP-712 payload, with uint64 values as decimal strings. Pass it to `eth_signTypedData_v4`, or to viem/wagmi `signTypedData` without the `EIP712Domain` entry.
- Show the policy fields to the user.
- Prices are USD × 1e8 strings. Sizes are lots, where 1 lot = 10^-sizeDecimals SOL.

### 2. Owner signs
Easiest: sign the `typedData` from the draft response. With viem/wagmi:
```ts
const { EIP712Domain, ...types } = draft.typedData.types;
const ownerSig = await walletClient.signTypedData({ account: hedgeOwner, domain: draft.typedData.domain, types,
  primaryType: "HedgePolicy", message: draft.typedData.message });
```
Or use the browser-safe helper `shared/policy.ts`:
```ts
import { policyTypedData } from "../shared/policy";
const chainId = await walletClient.getChainId();
const ownerSig = await walletClient.signTypedData({ account: hedgeOwner, ...policyTypedData(policy, chainId) });
```
- The signature must come from the **Hedge** owner, i.e. the address in `policy.hedgeAccount`.
- Don't edit any policy field after the draft. A changed field invalidates the guard check.

### 3. `POST /api/hedges`: arm
Request: `{ policy, ownerSig, chainId }`. Response: a rule view (shown below), with HTTP 200.

The server refuses to arm when:
- the signature is invalid or isn't from the Hedge owner;
- the Trade and Hedge accounts are the same;
- the policy names a different environment or signer than the server runs;
- the signed policy was already used (`duplicate_rule`; each signed policy arms one rule, ever);
- the mark is already at or below the entry trigger (`entry_already_crossed`, which includes the current mark: draft a lower entry);
- the watched wallet holds no SOL (`no_eligible_sol`);
- a feed is stale (`cannot_arm`);
- the Hedge account has a position or open orders (`cannot_arm` / `hedge_account_busy`);
- another rule is already active on that Hedge account (`rule_active`);
- the Hedge account's usable margin is below the required margin (`insufficient_margin`). The server recomputes the minimum from current venue data and uses the larger of that and the signed `minMarginE6`;
- unified-account margin couldn't be read (`margin_unavailable`, HTTP 503: retry). Usable margin is perps `withdrawable` on standard accounts and spot USDC available on unified accounts.

### `GET /api/hedges?hedge=<Hedge address>` (**changed: `hedge` is now required**)
Response: `{ env, signer, rules: RuleView[] }`. This returns active rules only.

### `GET /api/hedges/<ruleId>`
Response: a rule view, including finished rules.

### `POST /api/hedges/<ruleId>/disarm` and `POST /api/hedges/<ruleId>/close`
Get a ready-to-sign payload from `GET /api/hedges/<ruleId>?command=close&chainId=<id>` (or `command=disarm`). It needs no session and returns `{ issuedAt, chainId, typedData }`. Sign `typedData` the same way as the policy, then POST `{ signature, issuedAt, chainId }`. The structure is:
```ts
types: { HedgeCommand: [{ name: "ruleId", type: "bytes32" }, { name: "command", type: "string" }, { name: "issuedAt", type: "uint64" }] }
message: { ruleId, command: "disarm" | "close", issuedAt: BigInt(Date.now()) }
```
Request: `{ signature, issuedAt, chainId }`. The signature must be less than 5 minutes old.
- **Flat rule:** it ends immediately.
- **Open short:** the rule moves to `closing`, and the worker buys back with reduce-only orders inside the signed ceiling.
- Disarm and close wait for any worker step already in flight for that account. **Show "disarmed" or "closing" only from the response's `status`/`phase`**, not optimistically.

### Rule view
```jsonc
{
  "id": "0x…", "env": "testnet", "status": "active" | "done",
  "phase": "armed" | "opening" | "open" | "closing" | "closed" | "missed" | "expired" | "paused",
  "reason": "waiting-for-entry",          // the engine's last reason; use it for UI copy
  "shortLots": "40",                      // confirmed venue short, in lots
  "stopStatus": "none" | "checking" | "active" | "missing",
  "pending": { "kind": "entry" | "resize" | "close", "lots": "40", "limit": "686000" } | null,
  "retryUntil": 1794666030000 | null,
  "signerKind": "fallback" | "guard",
  "policy": { /* HedgePolicy */ },
  "actions": [{ "intent": "entry", "cloid": "0x…", "stopCloid": "0x…", "lots": "40", "nonce": 1794…,
               "transport": "reserved" | "signed" | "sent" | "acked" | "unknown" | "rejected",
               "outcome": "filled" | "partial" | "zero" | "rejected" | "canceled" | "resting" | null,
               "oid": 123, "filledLots": "40", "error": null }],
  "fills": [{ "tid": 1, "oid": 123, "px": "69.9", "sz": "0.4", "side": "A", "time": 0, "fee": "0.01" }]
}
```
UI labels (section 12):

| Condition | Label |
| --- | --- |
| `stopStatus: active` | **Recovery stop active** |
| `stopStatus: missing` | **Recovery stop missing** |
| `stopStatus: checking` | **Checking recovery stop** |
| `pending.kind: entry` | **Entry pending** |
| `pending.kind: resize` | **Buyback pending** |
| `phase: closing` | **Closing** |
| `reason: exit-price-outside-band` | **Close blocked** |
| `reason: resize-price-outside-band` | **Resize blocked** |
| `phase: missed` | **Missed entry** |
| `reason: cancelling-hedge-orders` | **Closing** (flat; cancelling leftover stop orders) |
| `reason: recovery-stop-filled` | **Closed by recovery stop** (the venue stop filled at the recovery price) |
| `reason: recovery-stop-partial` | **Recovery stop partially filled** |

An action with `transport: unknown` means **Checking order**. Show it as pending, never as filled.

### `GET /api/events?rule=<ruleId>[&after=<id>]` (**changed: `rule` is now required**)
Server-sent events. The event types are `armed`, `reserved`, `order`, `stop`, `phase`, `paused`, `disarm`, `close`, `cancel-leftovers` and `stop-filled`. Each event's data is `{ id, env, ruleId, kind, data, at }`. On reconnect, pass `after` (or rely on `Last-Event-ID`) and refetch `GET /api/hedges/<ruleId>`.

## Funding (unchanged)
- `GET /api/transfers/assets` returns every external asset 1Click routes to or from Hyperliquid USDC: `{ assetId, symbol, blockchain, decimals, contractAddress, evmChainId, priceUsd }`.
- `POST /api/transfers/quote` with `{ direction: "fund" | "withdraw", role, baseAddress, venueAddress, amount, dry, externalAsset? }` returns a quote. `externalAsset` is any `assetId` from `/assets` (default Base USDC). `baseAddress` is the wallet on that asset's chain (EVM, Solana, NEAR and so on), and `amount` is in that asset's units. The response includes `externalAsset` and a `transfer` whose `type` is `baseErc20Transfer`, `evmErc20Transfer`, `evmNativeTransfer`, `solanaTransfer`, `deposit` or `hypercoreSendAsset`. With `dry: false` (mainnet only), it includes `depositAddress` and `transfer`.
  - `transfer.type === "baseErc20Transfer"`: the Base wallet sends USDC `transfer(to, amount)` on chain 8453.
  - `transfer.type === "hypercoreSendAsset"`: the Hedge or Trade owner signs `sendAsset` with exactly these fields. Never use `usdSend`.
- `POST /api/transfers/<id>/deposit` with `{ txHash }`: after the Base transfer (or `sendAsset`) is sent, report its hash. This speeds up 1Click and records the source transaction. It's optional but recommended.
- `GET /api/transfers/<id>` returns the saved quote and the NEAR Intents status. For inbound `fund` transfers it also returns `recipientAccount: { withdrawableUsdc, spotUsdc, accountMode, usableUsdc }`, the live Hyperliquid balance of the credited account. Use `usableUsdc > 0` for **Credited**: it works for both standard and unified accounts. `SUCCESS` from the provider isn't proof of credit: confirm usable margin with `GET /api/accounts`, or the Base receipt.

## Owner-signed Hyperliquid actions (no SDK needed in the browser)
The server builds the canonical action plus its EIP-712 `typedData`. The owner's wallet signs it, and the server checks the recovered signer before relaying to Hyperliquid. Signatures are byte-identical to the official SDK's (tested).

- `POST /api/hl/approve-agent` with `{ agentAddress, chainId, purpose: "hedge" | "trade", validDays? }` returns `{ action, typedData }`.
- `POST /api/hl/approve-agent/submit` with `{ owner, action, signature }` returns `{ ok, signer, venue }`. It's refused unless `owner` signed it.
- `POST /api/transfers/:id/send-asset` with `{ chainId }` returns `{ action, typedData }` for a `withdraw` quote. The action is exactly the quoted transfer.
- `POST /api/transfers/:id/send-asset/submit` with `{ action, signature }`. It must be signed by the quote's `venueAddress`, and **every signed field must equal the stored quote** (destination, token, amount, DEXes, sub-account) before the quote's `deadline`. Errors: `transfer_mismatch`, `quote_expired` (get a new quote).

For a `fund` quote, `transfer` now also includes `data`: the ERC-20 `transfer(depositAddress, amountIn)` calldata. Send `{ to: transfer.contract, data: transfer.data, value: 0 }` on chain 8453.

Integration walkthrough: [INTEGRATION.md](INTEGRATION.md).

## Sign-in (owner sessions)
Rule reads (`GET /api/hedges?hedge=`, `GET /api/hedges/<id>`) and `GET /api/events` need a session for that rule's Hedge or Trade owner. Draft, arm and disarm/close don't need one: they carry their own owner signatures.

1. `POST /api/session/challenge` `{ address }` → `{ message, nonce, expiresAt }`. The message is bound to the API's `APP_ORIGIN`, the environment, the address and a single-use nonce, and it expires after 5 minutes.
2. The wallet signs `message` with `personal_sign` (viem `signMessage`). This authorizes no trades or transfers.
3. `POST /api/session/verify` `{ nonce, signature }` → `{ address, expiresAt }`, plus an `HttpOnly; SameSite=Lax` cookie (`Secure` over HTTPS) valid for 12 hours.
4. `GET /api/session` → `{ addresses }`. `POST /api/session/signout` clears the session.

A browser holds one session cookie at a time, so signing in as another address replaces it.

**Deployment shape (recommended):** proxy `/api/*` from the Vercel app to the backend with a Vercel rewrite, so the API is same-origin and the Lax cookie works. Then set the backend's `APP_ORIGIN` to the Vercel URL. If you call the backend cross-origin instead, use `fetch(..., { credentials: "include" })`. Note that a Lax cookie isn't sent on cross-site requests, so the rewrite is the supported path.
