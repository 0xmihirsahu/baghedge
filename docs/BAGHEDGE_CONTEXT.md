# Baghedge: full build context

This is the in-repo source of truth for Baghedge's product, engineering, demo, and submission plans. It carries forward the decisions from revision 8. Use [AGENTS.md](../AGENTS.md) for coding rules and the [README](../README.md) for current setup and API commands.

**Snapshot:** November 14, 2026.

## What runs today

- **Local API:** reads Hyperliquid markets and account snapshots, reads liquid SOL, and previews a hedge. A preview doesn't sign or arm a rule. Keep the API on localhost while wallet sessions and access controls are pending.
- **1Click:** returns Base ↔ HyperCore USDC quotes and status. In mainnet mode it can create an executable quote and return an unsigned transfer. A quote or provider status alone doesn't prove settlement.
- **Replay:** `bun run demo:replay` shows Trade and Wallet Hedge exposure with sample fills. It runs separately from the API.
- **Guard:** `guard/` builds a local WASM probe for reading a build-bound public key or signing a fixed-format challenge. An attested OutLayer run and a guard-signed venue order still need proof.
- **Planned:** live hedge worker, signed rule storage, wallet sessions, order submission, native stake reads, and payout verification. The frontend teammate owns the Vite terminal, which isn't in this checkout yet. The rest of this brief describes the target product.

**Labels**
- **(docs):** checked against the linked docs on Nov 14.
- **(observed):** seen in a live read on Nov 14 by the team.
- **(test):** behavior to confirm with a small live run before relying on it.
- **(proposal):** a suggested design or code shape. Change it if you have a better one.

**Using this with Cursor**
- Cursor reads `AGENTS.md` at the repo root and in subfolders ([Cursor rules](https://cursor.com/docs/rules)). Project rules go in `.cursor/rules/*.mdc`, and Cursor recommends keeping each rule under 500 lines.
- So: keep this big file at `docs/BAGHEDGE_CONTEXT.md` and @-mention it, or the relevant section, when you need it.
- Start with the root [AGENTS.md](../AGENTS.md) for the rules that apply to every task.

---

## Contents

**Part A: Product**
1. What we're building (TL;DR)
2. Decisions already made (revision 8)
3. Pitch and copy
4. User, job and demand
5. Core product, hedge rules, and extensions
6. What Baghedge adds over existing products

**Part B: UX spec**
7. One terminal, two account roles
8. Accounts and signers
9. Trade flow
10. Wallet Hedge flow
11. Exposure math and the on-screen table
12. UI state labels

**Part C: Engineering**
13. Repo layout, file tree, commands
14. Environments and configuration
15. Coding conventions
16. Core types and records
17. Internal API (browser ↔ server)
18. Hedge rules: policy, states, scheduler, sizing, price bounds
19. Hyperliquid integration
20. Funding and payout (NEAR Intents 1Click)
21. Solana balance reads
22. The guard (OutLayer signer)
23. Margin and risk math
24. Security and trust boundary

**Part D: Plan, tests, demo, submission**
25. Team split and parallel tracks
26. Venue experiments ($10 tests)
27. Release-candidate checks
28. Replay fixtures and evidence
29. Demo (90 seconds)
30. Judging and the README
31. Submission checklist
32. Open checks
33. Glossary
34. Link index

---

# Part A: Product

## 1. What we're building (TL;DR)

- **Baghedge is a Hyperliquid trading terminal with a wallet-aware SOL hedge.** Users search markets, read candles, place and manage perp orders, and see positions in one place.
- **Wallet Hedge mode.** On the same chart, the user sets a rule to hedge SOL they already hold in Phantom. Their SOL never moves.
- **Two Hyperliquid accounts.** The hedge short lives in a separate Hedge account. Manual trades live in the Trade account, and the two are never the same.
- **Funding.** NEAR Intents (1Click) moves USDC from Base into either account and back to Base.
- **A worker runs the hedge.** It watches the Hyperliquid mark and the Phantom wallet, and keeps running after the browser closes.
  - It opens the hedge on a price crossing, sized to min(cap, eligible SOL).
  - It buys back the excess when the watched balance drops.
  - It closes the hedge on recovery, at expiry, or when the user asks.
- **The entry requests an attached recovery stop.** A stop confirmed active on Hyperliquid can attempt an exit when our worker is down. Test the attached IOC behavior before relying on it.
- **An OutLayer enclave (TEE) holds the hedge's trading key.** That key is a named, expiring Hyperliquid agent. It signs only actions the user's signed policy allows.
- **The demo moment.** The user moves SOL out of Phantom. Only the hedge shrinks, and the manual long stays open.
- **Stack.** One Bun package: Vite + React + TypeScript in the browser, a Bun server and worker with SQLite, and a Rust `wasm32-wasip2` guard.

## 2. Decisions already made (revision 8)

| Topic | Decision |
| --- | --- |
| Positioning | Terminal first, with a wallet-aware hedge. Headline: "Trade perps. Hedge your bag." |
| Repo | One Bun package at the root: `src/`, `server/`, `shared/`, `fixtures/`, `guard/`. No pnpm workspaces, Turborepo or Next.js. |
| Frontend | Vite + React + TypeScript, Lightweight Charts, the Hyperliquid TypeScript SDK (`@nktkas/hyperliquid`). |
| Wallets | Start with connected wallets: Phantom for Solana, and an EVM wallet for each Hyperliquid master account and for Base USDC. Privy is optional. Add its polyfill only if Vite throws `process is not defined`. |
| Accounts | Two distinct user-owned Hyperliquid master accounts, Trade and Hedge. Reject equal IDs in the UI, the adapter and the signing path. |
| Entry | Worker-driven. On a fresh mark crossing, the worker reads the wallet and venue state, then the guard signs a bounded IOC sell. |
| Recovery stop | Request a child order with the entry (`grouping: "normalTpsl"`). Verify the venue behavior before relying on it. Show "Recovery stop active" only after the venue confirms it. |
| Retries | Retry only after a confirmed zero fill, inside the signed price band and entry window. A partial fill ends the opening cycle. |
| Exits | The worker handles wallet-based resizing, timed exits, and closes. A confirmed venue stop can attempt the price-based recovery exit during an outage. |
| `scheduleCancel` | Not used for expiry. It cancels every order, including the recovery stop. |
| Resting venue entry | A separate experiment, not the baseline. It could fire against a stale wallet balance. |
| Offline claims | The pitch and X post don't claim the entry works offline. |
| Funding | Base USDC ↔ HyperCore perps USDC through 1Click. Start with `EXACT_INPUT`. |
| Persistence | SQLite (`bun:sqlite`) once the worker handles live rules. |
| Signer fallback | A server-held, narrowly scoped agent, used only for a clearly labeled demo if the enclave path fails. |
| Extensions | A Chain Signatures-owned Hedge account, a custom NEAR contract, `/judge`, and `JUDGES.md`. |
| Track | Unstoppable DeFi (`defi`). Add others only if the shipped project fits. |

## 3. Pitch and copy

**Landing headline**
> Trade perps. Hedge your bag.

**One line**
> A Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet.

**Two lines**
> Search markets, trade perps, and manage Hyperliquid positions in Baghedge. Switch to Wallet Hedge on the same chart to set a price rule for your SOL, fund it through NEAR Intents, and see how much SOL exposure you still have.

**30-second intro**
> Baghedge is a trading terminal for Hyperliquid. You can search markets, read candles, place orders, and manage positions right here. If you hold SOL in Phantom, switch to Wallet Hedge. Pick how much SOL to hedge and when the hedge should start and end. NEAR Intents moves USDC from Base into a separate hedge account. If your watched balance drops below the short, Baghedge buys back the excess. The screen shows your wallet, your trades, and how much SOL exposure you have left.

**Rule copy example**
> Hedge up to 6 SOL if the perp mark crosses down through $140. Try to close on recovery to $161 or when the rule ends. Runs once.

**Copy rules (proposal)**
- Don't say "lock", "protect", "insure" or "guarantee".
- Say "hedge", "try to close", and "estimated".
- Show costs in dollars.
- Label every number as live, testnet, dry quote or replay.

**Landing page.** The primary action is **Open terminal**. Show a real terminal preview: market picker, chart, ticket with both modes, and the SOL held, filled short and remaining exposure.

## 4. User, job and demand

**First user**
- Already trades perps, or understands how a short works.
- Holds SOL in Phantom and has USDC for margin.
- Wants to stay in SOL through a specific event or price level.

**Why not just sell?**
- A holder with native stake has a clear reason. Unstaking has a cooldown, and instant unstake is a separate service that can charge a fee.
- Liquid SOL can be sold in seconds. For that holder, hedging has to win on taxes, conviction or the risk of buying back higher.
- [Coinbase SOL staking lifecycle](https://docs.cdp.coinbase.com/prime/concepts/staking/staking-lifecycle) · [Marinade instant unstake](https://marinade.finance/blog/unlocking-liquidity-how-marinades-instant-unstake-solves-a-core-solana-native-staking-pain-point)

**Job.** "Trade normally in **Trade**. When I want to reduce downside on SOL I already own, let **Wallet Hedge** run the second position, its margin, and the balance changes I'd otherwise track by hand."

**Demand test**
- Give a SOL holder a real margin quote and the rebound replay.
- Ask when they last needed this, how they handled it, and whether they'd post the quoted USDC for their next event.
- In the worked example, the holder posts about $192 to hedge $840 of SOL at entry.

**Business hypothesis**
- Test a disclosed fee on executed hedge trades through Hyperliquid builder codes, once users come back. The user approves a maximum fee.
- Keep the builder fee separate from venue, route and funding costs.
- Distribution through a wallet is a later test. [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)

## 5. Core product, hedge rules, and extensions

Use the complete SOL flow to validate the shared order, funding, and account logic. Extend it as each new asset, route, or account model passes its own checks.

**Core workflow**
- **Terminal:** search across Hyperliquid's default perps, with live execution for SOL first. Enable another market only after the same precision, sizing and order-lifecycle checks pass for it.
- **Trade ticket:** market (bounded IOC) and limit (GTC) orders, cancel, and reduce or close with reduce-only. Positions, open orders, holdings, activity and funds.
- **Wallet Hedge:**
  - one watched Solana address;
  - one active SOL hedge per dedicated Hedge account;
  - one SOL short rule;
  - two distinct master accounts;
  - Base USDC as the funding asset.
- **Eligible SOL:** liquid SOL, plus verified native stake accounts whose withdraw authority is the watched address.
- **Funding and payout:** Base ↔ HyperCore perps through 1Click, for either account.
- **Worker:** entry, resize, recovery, expiry and close, with an attached recovery stop. Runs after the browser closes.
- **Guard:** an OutLayer signer. If it fails, a clearly labeled server-held fallback.
- **Replay:** a no-wallet replay of the full two-mode run, plus one failure run.

**Rules for the SOL hedge**

- Each signed rule covers one cycle. A new hedge needs a new review after close or auto-deleveraging (ADL).
- A partial fill ends opening. Show the quantity that actually filled and its recovery stop status.
- A resting venue entry stays an experiment because it can fire against a stale wallet balance.

**Extensions to evaluate**

- Hedge other assets or watch multiple addresses once the product can verify fresh balances and avoid double-counting exposure.
- Count LP positions or wrapped SOL after validating how they convert into SOL exposure.
- JitoSOL and mSOL, once balances and conversion rates are verified.
- A Privy embedded wallet for the Hedge owner.
- The builder-code fee.
- A Chain Signatures-owned Hedge account, or a custom NEAR contract.
- A `/judge` page and `JUDGES.md`.
- Push or email alerts.

## 6. What Baghedge adds over existing products

| Product | What it already does | Where Baghedge differs |
| --- | --- | --- |
| [Phantom Terminal](https://help.phantom.com/articles/trade-spot-and-perps-in-phantom-terminal-46527102843027) | TradingView charts, Solana spot, Hyperliquid perps, TP/SL and wallet tracking. Its help page doesn't mention hedging. Perps aren't available in the US, the UK and other territories (docs). | The same kind of terminal, plus a hedge rule tied to SOL in the watched wallet, with exposure shown from confirmed fills. |
| [Prow Spot Hedge](https://prowdex.com/docs/bots/spot-hedge) | A matching short with sizing controls, margin warnings and a liquidation guard. For spot held elsewhere, the user enters the size and keeps it in sync. | Reads a Solana address and shrinks the hedge when the short exceeds the eligible balance. |
| [Hyperliquid TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl) | Price-triggered venue orders and position stops. | Ties the rule to wallet holdings, separate accounts, and Base funding and payout in one interface. |
| [DeFi Saver](https://defisaver.com/features/hyperliquid) | Hyperliquid automations, including hedges for supported lending positions. | Starts from SOL held in a wallet, with the short funded separately. |
| [NullPoint](https://github.com/demigohu/nullpoint), [ZeroDelta](https://github.com/g4stein/zerodelta), [Unhuntable](https://github.com/Jennycruzy/unhuntable) | Hackathon entries with related vault, constrained-signing and enclave-order ideas. | The demo workflow: a manual perp plus a separate wallet hedge, then a wallet transfer that changes only the hedge. |

**The field.** The team counted 1,404 entries across 13 tracks on Nov 14. Several share mechanics or signing tools with us, and some demos were inaccessible. When claiming originality, describe the exact workflow Baghedge demonstrates. [Project directory](https://nearhackathon.com/#projects)

---

# Part B: UX spec

## 7. One terminal, two account roles

| Area | What it shows |
| --- | --- |
| Market header | Searchable Hyperliquid perps, the selected market, mark, funding rate and market stats. Visible before connecting. |
| Main chart | Candles with interval controls. In **Wallet Hedge**, also the entry, recovery and estimated-liquidation levels. The mark and actual fills are shown separately. |
| Ticket | **Trade** or **Wallet Hedge**. The destination account is labeled on every review and confirmation. |
| Account panel | Positions, Open orders, Holdings, Activity, Funds, grouped by account so the user can see where an order or balance lives. Shows an existing Hyperliquid position on connect. |
| Exposure | Eligible SOL in the watched wallet, the confirmed Hedge short, the manual Trade position, and the two exposure totals (section 11). |

**Navigation**
- The same chart and market selection carry across both modes.
- Start in **Trade**.
- **Hedge SOL** in Holdings selects the SOL chart and opens **Wallet Hedge**.
- Other markets stay tradable even though SOL is the only wallet hedge.

**Chart behavior (proposal)**
- Typed prices and draggable lines edit the same draft. Any edit that changes what the automation may do needs a fresh review.

## 8. Accounts and signers

| Account | What it does | Who signs |
| --- | --- | --- |
| Watched Solana address | The Phantom address whose eligible SOL feeds the rule. | Nobody: we only read the address and balances. The rule grants no authority to move SOL. |
| Trade account | The user's Hyperliquid master account for manual trading. Link an existing EVM wallet or onboard a new one. | The owner signs funding and payouts. The owner, or a dedicated Trade signer, signs orders. |
| Hedge account | A separate user-owned Hyperliquid master account with its own margin. | The owner signs approvals, the policy and payouts. A named, expiring guard key signs scoped hedge actions. The owner keeps venue access for recovery. |
| Base funding wallet | Signs the Base USDC deposit, and can receive an approved payout. It may be the same EVM wallet as a venue account. | The user reviews source, recipient and refund address for each transfer. |

**Rules**
- Use two master accounts. Hyperliquid's subaccounts need a trading-volume threshold first ([subaccounts](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/sub-accounts)).
- A separate EVM wallet is the baseline for independent owner access. An embedded wallet is optional, after verifying Hyperliquid typed-data signing and that the user can manage the account independently.
- Show shortened addresses, with a way to inspect the full address.
- A failed or pending Hedge setup must leave Trade usable.

[Phantom connection](https://docs.phantom.com/solana/establishing-a-connection) · [Privy wallet creation](https://docs.privy.io/wallets/wallets/create/create-a-wallet)

## 9. Trade flow

1. **Find a market.** Search for SOL-PERP and inspect candles, mark and funding. The venue adapter resolves tick size, lot size and enabled order types for the market.
2. **Connect the Trade account.**
   - An existing Hyperliquid user sees positions, open orders and usable USDC.
   - A fresh account sees **Add funds**: review a Base USDC quote through NEAR Intents, sign from Base, and wait for usable balance. Account for the fresh-account activation fee before quoting usable margin.
3. **Place an order.**
   - Choose long or short, market or limit, size, and leverage or margin mode where supported. Enter a price for a limit order, or a max slippage for a market order.
   - Review notional, required margin, estimated fees and the resulting position. On a market with an existing position, a trade can reduce, close or flip it.
   - Send it to Hyperliquid from the ticket.
4. **Follow the order.**
   - A resting limit appears in **Open orders** with **Cancel**.
   - A confirmed fill updates **Positions**: size, average fill, P&L, margin and liquidation estimate. A partial fill can appear in both panels.
   - If the response is unclear, show **Checking order** and reconcile before retrying.
5. **Manage and close.**
   - Reduce or close from **Positions** with reduce-only orders. Show the remaining size after partial execution, and confirm the final close from venue data.
   - Manual SOL trades change the combined exposure display, but leave the Wallet Hedge rule untouched.
6. **Withdraw from Trade.** In **Funds**, pick the Trade account and a Base destination, review a fresh quote, and sign the transfer as owner. Show available USDC, route status and the destination receipt. Trade and Hedge balances stay separately selectable.

**Acceptance**
- From the terminal: submit and cancel a real limit order; open a position and see its fill; reload and recover the position; reduce or close it and see the resulting size.
- Verify fresh-account funding and withdrawal through the shared route adapter.
- A user can trade with only a Trade account.

## 10. Wallet Hedge flow

1. **Choose what to watch.**
   - Connect Phantom and show the eligible SOL breakdown: liquid SOL plus verified native stake whose withdraw authority is the watched address.
   - Add JitoSOL and mSOL only after verifying balances and conversion rates. Show unsupported holdings separately.
   - The rule follows the address. A transfer to another address the user owns can shrink the hedge. Say so before they sign.
2. **Set the rule on the chart.**
   - Enter a fixed SOL cap, or a percentage that becomes a fixed cap at review.
   - Place the entry and recovery levels by typing or by dragging lines.
   - Choose the end time and the execution tolerances (entry floor, buyback ceiling).
3. **Review.** Show:
   - the latest mark and wallet read, and the separate Hedge address;
   - initial margin, stress buffer and estimated liquidation;
   - fees, variable funding, and the entry and exit execution limits;
   - what happens if the price crosses and nothing fills;
   - approximate exposure after a full fill and after a partial fill.
4. **Fund and arm.**
   - Quote Base USDC to the Hedge account. The user signs the deposit, approves the guard as a named agent, and signs the hedge policy. Each prompt says which wallet signs and why.
   - Funding states: **Awaiting signature → Deposit detected → In transit → Credited**.
   - The rule is **Armed** once the Hedge account is ready and the worker has recorded the signed policy.
   - If approval fails after funding, the owner can retry or withdraw. If the price has already crossed at arming, prompt for a fresh review.
5. **Open and track.**
   - On a qualifying crossing, read the current eligible balance and venue state. The guard signs a bounded short, sized at most to the reviewed cap and the latest eligible SOL, with the recovery stop attached.
   - Show the actual filled size, and track the short and the recovery stop separately: **Entry pending**, **Recovery stop active**, **Recovery stop missing**, **Checking recovery stop**.
   - A partial short can exist without an active stop.
6. **Resize when holdings fall.**
   - If the watched SOL drops below the confirmed short, request a reduce-only buy for the excess. Show **Buyback pending** until it's confirmed.
   - A wallet increase leaves the open hedge alone.
   - A move between liquid SOL and eligible native stake under the same authority should keep the eligible total unchanged once the reads reconcile.
7. **End the hedge.**
   - On recovery, expiry or **Close hedge now**: stop new entry attempts, and buy back the remaining short reduce-only. Show **Closing** or **Close blocked** until it's confirmed flat.
   - **Disarm** before entry stops new orders and reconciles any entry already submitted.
   - An unexpected venue close, liquidation or ADL ends automated entry, and can offer a fresh **Re-hedge** review. A partially force-closed position still needs managing.
8. **Settle and withdraw.**
   - Show confirmed short P&L after fees and funding, and available USDC. Exclude deposit and withdrawal principal.
   - A wallet transfer changes what's tracked. Show combined P&L only when cash flows are accounted for; otherwise label it a replay estimate.
   - In **Funds**: pick Hedge, review a fresh Base quote, sign as owner, and show the destination receipt.

**During a worker outage**
- Show the last confirmed data, and whether a venue recovery stop is active.
- An active stop can attempt the recovery exit on its own, within its price limit.
- If the stop is missing or unconfirmed, show the remaining short and a direct owner close on Hyperliquid.
- A disconnected or stale wallet feed pauses new or larger hedge exposure.

## 11. Exposure math and the on-screen table

**Formulas (sizes in SOL)**
- **Watched wallet after hedge** = eligible SOL + signed Hedge position. A short is negative.
- **Net across linked accounts** = watched wallet after hedge + signed manual SOL perp in Trade.

These are size approximations, because the wallet and perp prices differ. Keep pending requests and confirmed fills separate.

| Stage | Watched SOL | Manual Trade | Hedge short | Watched wallet after hedge | Net across linked accounts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Manual order fills | 10 | +2 | 0 | +10 | +12 |
| Hedge fills | 10 | +2 | −6 | +4 | +6 |
| 5 SOL moves out, resize pending | 5 | +2 | −6 | −1 | +1 |
| 1 SOL buyback fills | 5 | +2 | −5 | 0 | +2 |
| Both positions closed | 5 | 0 | 0 | +5 | +5 |

UI copy at the pending step: **1 SOL overhedged in watched wallet · buyback pending**.

## 12. UI state labels

| Area | Labels |
| --- | --- |
| Funding | Awaiting signature · Deposit detected · In transit · Credited · Checking transfer · Refunded (only with proof) · Incomplete deposit · Failed |
| Rule | Draft · Armed · Entry pending · Missed entry · Open · Buyback pending · Resize blocked · Closing · Close blocked · Closed · Expired · Disarmed · Paused |
| Recovery stop | Recovery stop active · Recovery stop missing · Checking recovery stop |
| Orders | Checking order · Resting · Partially filled · Filled · Canceled · Rejected |
| Environment banner | Replay · Testnet · Mainnet (always visible during demos) |

---

# Part C: Engineering

## 13. Repo layout, file tree, commands

**Revision 8 layout**

One Bun package at the root.
- Start with Vite, React, TypeScript and one `package.json`.
- Add a Bun server entry point when you wire funding and Wallet Hedge.

```text
baghedge/
  package.json
  bun.lock
  README.md
  src/          landing page, terminal, wallet connections
  server/       funding API and hedge worker
  shared/       units, schemas, exposure math
  fixtures/     demo replay data
  guard/        standalone OutLayer signer and early signing probe
```

- **Dev and build.** Run the API now with `bun run dev:server`. When the frontend lands, use `bun run dev` for Vite and `bun run build` for the browser bundle. Proxy `/api` to the local server ([Vite proxy](https://vite.dev/config/server-options.html#server-proxy)).
- **Imports.** Import `shared/` with ordinary imports. Keep it safe to run in the browser.
- **Who sends what.** The browser signs manual orders and sends them straight to Hyperliquid. The server holds the routing credentials and runs Wallet Hedge after the browser closes.
- **Persistence.** Give the worker a persistent SQLite file once it handles live rules ([Bun SQLite](https://bun.sh/docs/runtime/sqlite)).
- **Hosting.** Serve `dist/` with `/api` routed to the worker ([Vite static deploy](https://vite.dev/guide/static-deploy.html)).
- **The guard.** It's a standalone Rust crate in `guard/`, with its `Cargo.toml`, `Cargo.lock`, manifest and WIT files inside it. Validate the signer probe alongside the terminal so order integration has a verified signer to work with.

**Detailed file tree (proposal)**

```text
baghedge/
├─ package.json  bun.lock  tsconfig.json  vite.config.ts  index.html
├─ .env.example  .gitignore  AGENTS.md  README.md  LICENSE
├─ docs/BAGHEDGE_CONTEXT.md          # this file
├─ src/                              # browser only
│  ├─ main.tsx  App.tsx
│  ├─ landing/Landing.tsx
│  ├─ terminal/
│  │  ├─ MarketPicker.tsx            # metaAndAssetCtxs search
│  │  ├─ Chart.tsx                   # lightweight-charts; candles + price lines + fill markers
│  │  ├─ TradeTicket.tsx             # market (bounded IOC) / limit (GTC) / reduce-only
│  │  ├─ HedgeTicket.tsx             # cap, entry, recovery, end time, tolerances
│  │  ├─ ReviewModal.tsx             # exact reviewed values; which wallet signs what
│  │  ├─ AccountPanel/{Positions,OpenOrders,Holdings,Activity,Funds}.tsx
│  │  └─ ExposurePanel.tsx           # section 11
│  ├─ wallets/
│  │  ├─ phantom.ts                  # Solana connect, address, signMessage
│  │  ├─ evm.ts                      # viem wallet client (EIP-1193)
│  │  └─ roles.ts                    # Trade / Hedge / Base funding role binding
│  ├─ hl/
│  │  ├─ clients.ts                  # @nktkas/hyperliquid Info/Exchange/Subscription per env
│  │  ├─ manualOrders.ts             # build, submit, reconcile manual orders (cloid first)
│  │  └─ streams.ts                  # candle, activeAssetCtx, bbo/l2Book, orderUpdates, userFills
│  ├─ api/client.ts                  # /api calls + SSE (/api/events)
│  └─ state/store.ts
├─ server/                           # Bun
│  ├─ index.ts                       # Bun.serve: /api routes + SSE; starts the worker
│  ├─ db.ts                          # bun:sqlite schema, migrations, unique constraints
│  ├─ session.ts                     # challenge/verify (nonce bound to origin + env + address)
│  ├─ routes/{hedges,transfers,events}.ts
│  ├─ worker/
│  │  ├─ scheduler.ts                # per-Hedge-account serialized loop (section 18)
│  │  ├─ opening.ts                  # crossing → reserve → guard sign → submit → reconcile
│  │  ├─ recoveryStop.ts             # confirm child; replace after partial; repair on restart
│  │  ├─ resize.ts  closing.ts  reconcile.ts
│  │  └─ observations.ts             # WalletObservation / VenueObservation freshness
│  ├─ venues/
│  │  ├─ hyperliquid.ts              # info, ws, exchange submit; master-address reads
│  │  └─ solana.ts                   # liquid + stake (+ LST later) reads with slots
│  ├─ intents/oneclick.ts            # tokens, quote, deposit/submit, status
│  └─ guard/client.ts                # OutLayer call; checks the action hash before submit
├─ shared/                           # browser-safe, pure
│  ├─ units.ts                       # lamports, lots, USD e8 prices, token base units
│  ├─ precision.ts                   # perp tick/lot rules, including the integer price exception
│  ├─ exposure.ts                    # section 11 math
│  ├─ policy.ts                      # EIP-712 HedgePolicy types + helpers (section 18)
│  ├─ hlWire.ts                      # order/cancel/modify wire builders; cloid derivation
│  ├─ rules.ts                       # states, transitions, size rule, price bounds
│  ├─ assets.ts                      # 1Click asset IDs, HyperCore USDC token
│  └─ schemas.ts                     # zod (or similar) schemas for API payloads
├─ fixtures/
│  ├─ replay/{two-mode-run,failure-timeout,gap-no-fill,adl}.json
│  └─ vectors/hl-actions.json        # action → msgpack hex → hash → signature, from the official SDK
├─ guard/                            # Rust, wasm32-wasip2 component
│  ├─ Cargo.toml  Cargo.lock  rust-toolchain.toml
│  ├─ (OutLayer manifest + wit/ as the Signing Keys docs show)
│  └─ src/{main.rs,io.rs,policy.rs,hl.rs,ops.rs}
└─ scripts/
   ├─ venue/*.ts                     # the $10 experiments (section 26), run with bun
   ├─ replay.ts  verify-quotes.ts
   └─ build_github_wasm.sh           # copied from OutLayer
```

**Commands.** The [README](../README.md#run-it) is the runnable setup. The planned commands below become available when their features land.

| Command | Status | Does |
| --- | --- | --- |
| `bun run dev:server` | Now | Local Bun API with reload |
| `bun run check` | Now | Typecheck and Bun tests |
| `bun run demo:replay` | Now | Standalone sample-fill run showing both account roles, without keys or network writes |
| `bun run verify:quotes` | Now | 1Click `dry: true` quotes in both directions, without a signer |
| `cargo +stable build --locked --manifest-path guard/Cargo.toml --target wasm32-wasip2 --release` | Now | Local WASM probe build. Install the target as shown in the [README](../README.md#outlayer-probe). |
| `bun run dev`, `bun run build` | Planned | Vite dev server and browser bundle |
| Reproducible guard build | Planned | Pin the toolchain and add the upstream build script. See section 22. |

**Read-only probes to run first** (from a fresh checkout, before wiring a signer):

```sh
curl -fsS https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"metaAndAssetCtxs"}'
curl -fsS https://1click.chaindefuser.com/v0/tokens
```

**Dependencies (proposal; pin versions when you add them)**
- **Browser:** `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `@nktkas/hyperliquid`, `viem`, `lightweight-charts`, `@solana/web3.js`.
- **Shared:** a decimal library (`decimal.js` or `big.js`) and `zod` for schemas.
- **SDK runtime support:** the Hyperliquid TypeScript SDK supports Node 22.12+, Bun 1.3.3+, Deno 1.23+ and React Native 0.86+ ([SDK docs](https://nktkas.gitbook.io/hyperliquid)).

## 14. Environments and configuration

| Mode | Hyperliquid | Solana | Funding | Signing |
| --- | --- | --- | --- | --- |
| Replay | Fixtures | Fixtures | Fixtures | Fixture responses |
| Testnet | Hyperliquid testnet | Devnet, or recorded fixtures, labeled | Pre-fund through the venue's supported test path | Test-only wallets and agent |
| Mainnet | Hyperliquid mainnet | Solana mainnet | Base mainnet ↔ HyperCore perps through 1Click | Owner wallets and the approved guard |

**Hosts (docs)**
- Hyperliquid mainnet: `https://api.hyperliquid.xyz`.
- Hyperliquid testnet: `https://api.hyperliquid-testnet.xyz`.
- Streams use `wss://` on the matching host, at `/ws`.
- 1Click: `https://1click.chaindefuser.com` (mainnet only; Intents has no testnet).
- OutLayer: `https://api.outlayer.ai` (testnet: `https://testnet-api.outlayer.ai`). On-chain contracts: `outlayer.near` and `outlayer.testnet`.

The API accepts only `APP_MODE=testnet` and `APP_MODE=mainnet`. Run replay with `bun run demo:replay`; it doesn't need an API server. Copy [`.env.example`](../.env.example) for the current API settings. The following example also shows planned frontend and signer settings.

```bash
# ---- browser (public) ----
VITE_APP_MODE=testnet           # planned browser mode: replay | testnet | mainnet
VITE_PRIVY_APP_ID=              # optional; only if Privy is added

# ---- server / worker ----
APP_MODE=testnet                # testnet | mainnet; match the connected browser mode
APP_ORIGIN=http://localhost:5173
BAGHEDGE_DB_PATH=./data/baghedge.sqlite
# SOLANA_RPC_URL=https://api.devnet.solana.com  # optional; omit to use the mode's default
INTENTS_BASE_URL=https://1click.chaindefuser.com
INTENTS_JWT=                    # optional provider credential

# OutLayer project mode only (a separate build, see section 22)
OUTLAYER_API_URL=https://api.outlayer.ai
OUTLAYER_PROJECT=example.near/baghedge-guard
OUTLAYER_PAYMENT_KEY=           # header X-Payment-Key, format owner:nonce:secret
OUTLAYER_COMPUTE_LIMIT=50000    # USD micro-units per call (default 10000 = $0.01; min 1000)
# Direct WasmUrl mode uses the NEAR transaction signer, the published WASM URL, and its SHA-256.

# fallback signer (labeled demo only)
FALLBACK_AGENT_PRIVATE_KEY=
```

**Runtime limits (revision 8 proposed defaults; measure them in the live run)**
- Mark freshness: 5 s.
- Complete wallet read: 10 s.
- Entry window: 30 s.

Keep these in configuration. A settings change can't widen the limits of a rule that's already signed.

**Rules**
- Partition persisted state, signer approvals and cached venue data by environment.
- Disable real writes in replay.
- Keep the executable 1Click route out of testnet mode.
- Show the environment banner at all times.

## 15. Coding conventions

1. **Money and sizes are never JavaScript floats.**
   - Use decimal strings at JSON boundaries.
   - Store wallet amounts in lamports, Hyperliquid sizes in integer market lots (1 lot = 10^-szDecimals; SOL has szDecimals 2, observed), and route amounts in the token's smallest units.
   - Compare prices with fixed-point integers or exact decimal arithmetic. Convert to `number` only for charts and display.
2. **Timestamps** are UTC milliseconds. Record where each observation came from (stream or snapshot, slot).
3. **Addresses.** Normalize EVM addresses (lowercase) for equality checks. Keep Solana base58 exactly as given; it's case-sensitive.
4. **Journal before writing.** Persist the action ID and the fields needed to reconcile before submitting. Use the venue nonce for signed venue actions and one cloid per new order leg. For transfers, save the reviewed quote, deposit address, and signing account, then record the source receipt once known.
5. **Reconcile before retrying.**
   - An unknown result stays pending until order status, fills and positions rule it out.
   - Hyperliquid can report an order error inside a successful HTTP response. A fill can be smaller than the IOC size.
6. **One writer per Hedge account.** Serialize all actions per `(environment, hedgeAddress)`. Prefer one IOC in flight per Hedge account.
7. **Read with the master address.** Query Hyperliquid info with the master (owner) account address, never the agent's address. An agent address returns empty results (docs).
8. **Confirmed state only.** The UI shows confirmed state. Pending requests are labeled pending.
9. **Secrets.**
   - Never in the browser bundle or the logs: RPC keys, the 1Click JWT, the OutLayer payment key, any private key.
   - Don't publish reusable signed requests.
10. **Labels.** Every user-visible claim says whether it's replay, testnet, dry quote or mainnet.
11. **Tests.** Use `bun test`. Keep pure logic in `shared/` (units, precision, exposure, size rule, price bounds, state transitions) with unit tests. Golden vectors keep the TypeScript and Rust action bytes identical.
12. **Copy.** Follow section 3.

## 16. Core types and records

Revision 8 lists these records. The TypeScript below is a proposal.

```ts
// shared/types.ts (proposal)
export type Env = "replay" | "testnet" | "mainnet";
export type Lamports = bigint;          // SOL × 1e9
export type Lots = bigint;              // size / 10^-szDecimals
export type PriceE8 = bigint;           // USD × 1e8
export type UsdcBase = bigint;          // token smallest unit (Base USDC 6, HyperCore USDC 8 in 1Click)

export interface AccountLink {
  env: Env;
  ownerSession: string;
  tradeAddress: `0x${string}`;
  hedgeAddress: `0x${string}`;          // must differ from tradeAddress
  watchedSolana: string;                // base58, case-sensitive
  fundingWallet: `0x${string}`;
  guard?: { agentAddress: `0x${string}`; buildHash: string; agentName: string; validUntilMs: number };
  verification: Record<"trade" | "hedge" | "solana" | "guard", "unverified" | "verified" | "failed">;
}

export interface WalletObservation {
  watchedSolana: string;
  commitment: "confirmed" | "finalized";
  components: {
    liquid: { lamports: Lamports; slot: number; observedAt: number };
    stake?: { lamports: Lamports; slot: number; observedAt: number; accounts: string[] };
    lst?: { mint: string; raw: bigint; rateSource: string; lamportsEq: Lamports; slot: number }[];
  };
  scope: { liquid: true; stake: boolean; jitosol: boolean; msol: boolean };
  complete: boolean;                    // false → contributes "unknown", never a withdrawal
  eligibleLamports: Lamports;
}

export interface VenueObservation {
  env: Env;
  account: `0x${string}`;
  assetId: number;
  signedSizeLots: Lots;                 // short < 0
  usableMarginUsdc: string;             // decimal string
  openOrders: { oid: number; cloid?: string; isTrigger: boolean; reduceOnly: boolean; sz: string; triggerPx?: string; limitPx: string }[];
  mark: { px: string; at: number };
  observedAt: number;
  source: "stream" | "snapshot";
}

export type RuleState =
  | "draft" | "armed" | "opening" | "missed" | "open" | "resizing"
  | "closing" | "closed" | "expired" | "disarmed" | "paused";

export interface HedgeRule {
  id: string; version: number;
  policyDigest: `0x${string}`; policySignature: `0x${string}`;
  links: AccountLink;
  limits: HedgePolicy;                  // section 18
  state: RuleState;
  crossingCursor?: { lastMarkE8: PriceE8; at: number };
  currentActionId?: string;
}

export interface OrderAction {
  id: string;                           // stable across restarts
  ruleId?: string; ruleVersion?: number; tradeAccount?: string;
  intent: "entry" | "recovery_stop" | "resize" | "close" | "manual";
  qtyLots: Lots;
  cloid: `0x${string}`;                 // 16 bytes hex, saved before send
  signer: `0x${string}`; nonce: number; expiresAfter?: number;
  requestHash: `0x${string}`;
  transport: "reserved" | "sent" | "acked" | "unknown" | "failed";
  venueOid?: number; filledLots: Lots;
  outcome?: "filled" | "partial" | "zero" | "rejected" | "canceled";
  fills: string[];                      // tids
}

export interface Transfer {
  id: string;
  direction: "in" | "out";
  role: "trade" | "hedge";
  account: string; env: Env;
  originAsset: string; destinationAsset: string; decimals: { origin: number; destination: number };
  correlationId?: string; quoteSignature?: string;
  depositAddress?: string; amountIn: string; amountOut: string; minAmountOut?: string; deadline: string;
  sourceTx?: string; destinationTx?: string; refund?: { to: string; tx?: string };
  status: "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED" | "CHECKING";
}
```

**Database rules (revision 8)**
- **Unique constraints:**
  - the active Hedge rule per `(env, hedgeAddress)`;
  - separately, `(env, account, cloid)`;
  - observed fills.
- **Funding is its own record,** so a rule can disarm while a transfer keeps settling.
- **Record transitions atomically:** a state change and the action reserved for it are written together.
- **On restart,** resolve reserved or sent actions before generating a new one.
- **Polling and streams:** poll with backoff, and keep stream reconnects deterministic in replay.

## 17. Internal API (browser ↔ server)

The [README](../README.md#call-it-from-the-terminal) lists the implemented API. The table below is the target API. Today, hedge preview returns informational sizing and checks, without typed data or rule creation.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/session/challenge`, `POST /api/session/verify` | Owner session from a short-lived nonce bound to the app origin, environment and address. Use a same-origin session cookie. |
| `POST /api/hedges/preview`, `POST /api/hedges` | Return the exact review inputs and typed data, then accept the signed policy. Re-verify the owner signature, nonce, account links, deadlines and funding at arm time. |
| `GET /api/hedges/:id`, `POST /api/hedges/:id/disarm`, `POST /api/hedges/:id/close` | Get state, stop new entry, or request a reviewed reduce-only exit under the signed rule. Repeat requests return the current state. |
| `POST /api/transfers/quote`, `GET /api/transfers/:id` | Make the reviewed executable or dry quote, and fetch route state. The browser signs the exact reviewed transfer with the owner wallet. |
| `GET /api/events` | SSE updates for the session's rule and route records. Fetch fresh snapshots on reconnect. |

**Notes**
- **Manual orders** go straight from the browser's owner-signed Hyperliquid client. Store the cloid locally before submitting, and recover the venue state on reload.
- **Mutations** check session ownership on the server, and results are scoped to the account.
- **Watched address.** A Solana address can be watched read-only. A "you control this" badge needs a separate wallet message signature.

## 18. Hedge rules: policy, states, scheduler, sizing, price bounds

### What the signed policy authorizes (revision 8)

The policy binds:
- the app and environment;
- the Trade and Hedge account IDs and the watched wallet;
- the market, and the guard public key and build;
- the rule version and nonce;
- the fixed SOL cap and the price source;
- the entry and recovery triggers, and the entry and exit execution bounds;
- the expiry, minimum usable margin, and one-cycle behavior.

The authority to open and the authority to reduce are separate. After expiry, the worker may still manage a reduce-only exit within the reviewed limits while the guard approval is valid. Set the agent expiry with time for that cleanup, and show the owner's direct close path.

**Policy encoding (revision 8)**
- One versioned EIP-712 type, shared by the browser and the guard.
- A Baghedge-specific domain, environment separation, and a fresh policy nonce.
- Canonical integer units for the cap, price limits, margin and deadlines.
- Verify that the recovered signer owns the Hedge master account, and that the policy version is active.
- Keep venue action nonces separate from policy nonces.

[EIP-712](https://eips.ethereum.org/EIPS/eip-712)

```ts
// shared/policy.ts (proposal: field names and units are ours; revision 8 sets the requirements)
export const POLICY_DOMAIN = (chainId: number) => ({ name: "Baghedge", version: "1", chainId }); // chainId = signing wallet's active chain, recorded with the policy

export const POLICY_TYPES = {
  HedgePolicy: [
    { name: "environment", type: "string" },        // "mainnet" | "testnet"
    { name: "ruleId", type: "bytes32" },
    { name: "version", type: "uint32" },
    { name: "policyNonce", type: "uint64" },
    { name: "tradeAccount", type: "address" },
    { name: "hedgeAccount", type: "address" },
    { name: "watchedSolana", type: "bytes32" },     // decoded base58 pubkey
    { name: "watchScope", type: "uint8" },          // bitmask: 1 liquid, 2 native stake, 4 JitoSOL, 8 mSOL
    { name: "market", type: "string" },             // "SOL"
    { name: "assetId", type: "uint32" },            // from meta at review time
    { name: "priceSource", type: "string" },        // "hyperliquid-mark"
    { name: "guardAgent", type: "address" },
    { name: "guardBuildHash", type: "bytes32" },
    { name: "capLots", type: "uint64" },            // SOL lots (szDecimals 2 → 0.01 SOL)
    { name: "entryTriggerE8", type: "uint64" },     // USD × 1e8, mark crosses down through this
    { name: "entryFloorE8", type: "uint64" },       // lowest permitted sell fill
    { name: "recoveryTriggerE8", type: "uint64" },  // mark at or above → recovery exit
    { name: "buybackCeilingE8", type: "uint64" },   // highest permitted buy for recovery/expiry/resize
    { name: "entryWindowMs", type: "uint64" },      // 30000 default
    { name: "expiryMs", type: "uint64" },           // unix ms
    { name: "minMarginE6", type: "uint64" },        // USDC × 1e6
    { name: "oneCycle", type: "bool" },
  ],
} as const;
```

### States (revision 8)

| State | Entry condition | Next action |
| --- | --- | --- |
| `draft` | The user edits the ticket. | Review, fund, collect signatures. Transfer status stays independent. |
| `armed` | Fully funded, signed rule, healthy feeds, clean Hedge account, mark above entry. | Watch for a fresh crossing from above to at or below entry. A stale gap resets the crossing baseline. |
| `opening` | The worker reserves a bounded sell. | Reconcile by cloid. Retry confirmed zero fills inside the window and band. Recovery before any fill, or an expired window, ends opening. |
| `missed` | The window ended or recovery arrived, and every attempt is confirmed unfilled. | Show zero coverage and the reason. Trying again needs a new signed rule. |
| `open` | At least one fill confirmed. | Record the actual quantity and the separate stop status. Reconcile or place the stop. Close on recovery or expiry. Reduce on a verified scope decrease. A partial entry ends further opening. |
| `resizing` | A lower eligible balance is confirmed. | Buy back the excess under the policy, and reconcile before resuming. If recovery or expiry arrives, queue the close and recalculate against the remaining position. |
| `closing` | Exit trigger, expiry, disarm during an ambiguous entry, or owner action. | Stop entries, resolve pending sells and reductions, and send bounded reduce-only buys until flat or blocked. |
| `closed` / `expired` / `disarmed` | Confirmed flat with no unresolved sell, or no entry was ever sent. | Show payout and receipts. Starting again needs a new signed rule. |
| `paused` | An unexpected account action, a revoked signer, missing data, or an unresolved action. | Show the actual position, the last known state, the reason, and the owner's recovery path. Resume only after the specific condition is resolved. |

### The scheduler (revision 8)

**When it runs:** after each confirmed fill, position refresh, wallet change, mark update or deadline.

**Order within one account:**
1. reconcile pending actions;
2. handle an expired or triggered close;
3. consider a resize;
4. consider a new entry.

**Rules**
- Use the latest verified data per source.
- A crash before the venue's response is recorded must recover the same action ID, nonce and cloid.
- If a request expired and the venue gave no affirmative evidence, reconcile again before releasing its reservation.
- Persist the latest full state for the UI.

```ts
// server/worker/scheduler.ts (proposal sketch)
async function tick(acct: HedgeAccountCtx) {
  await withAccountLock(acct.env, acct.hedgeAddress, async () => {
    if (await reconcilePending(acct)) return;            // unknown/ambiguous actions first
    const rule = await activeRule(acct); if (!rule) return;
    const w = await freshWallet(acct, cfg.walletMaxAgeMs); // null if stale/incomplete
    const v = await freshVenue(acct, cfg.markMaxAgeMs);
    if (!v) return pause(rule, "venue_stale");
    if (shouldClose(rule, v, now())) return startClose(rule, v);   // recovery / expiry / owner
    if (rule.state === "open" && w && v.shortLots > w.eligibleLots) return resize(rule, w, v);
    if (rule.state === "armed" || rule.state === "opening") {
      if (!w) return;                                    // stale wallet blocks new exposure
      if (crossedDown(rule, v)) return openEntry(rule, w, v);
    }
  });
}
```

### Size rule (revision 8)

**At entry,** take `min(policyCap, eligibleWalletSOL) − confirmedShort − unresolvedSellQuantity`, round it down to market lots, and floor it at zero.
- **Unresolved sells:** count every resting and in-flight sell that could still fill. A second order can break the cap even if its own size is under it.
- **Reservations:** reserve the authority before signing, and release it only on confirmed reconciliation.

**During the live hedge,** keep the one-cycle rule by allowing only reductions.
- When `confirmedShort > eligibleWalletSOL`, reduce by the excess.
- If the buyback is below the venue minimum, show the residual and the user's full-close option.

### Price bounds (revision 8)

- **Entry floor.** A sell triggered at $140 with a 2% entry tolerance can't fill below **$137.20**.
  - If the best bid is below the floor, the attempt misses. Wait for another eligible quote inside the window, or finish as **Missed entry**.
- **Buyback ceiling.** Sign an absolute entry floor and a separate maximum buyback price at review. Apply the ceiling to recovery, expiry and resize.
  - If it blocks a buyback, show **Close blocked** or **Resize blocked**, the remaining exposure, and an owner action to review a fresh price and send a reduce-only order.
- **Margin.** Include the buyback ceiling in the margin stress check (section 23).

### Entry, cap, resize and close (revision 8)

- **Entry.**
  - The worker observes the mark crossing. Right before a bounded IOC sell, it reads the selected wallet and the venue state.
  - Retry confirmed zero fills inside the entry deadline and band, while data stays fresh and earlier child orders are resolved. Journal this as a new attempt with new cloids and nonce.
  - Reconcile an unknown submission before sending another.
  - A confirmed partial ends the opening cycle and leaves the rest unhedged.
  - The balance can move between the read and the fill. Show the observed coverage and any correction after it.
- **Cumulative cap.**
  - Count the filled short plus every unresolved sell. The worker must serialize reservations and reconcile pending orders before assigning more size.
  - To claim the guard enforces the cumulative cap, it needs a trusted current view of fills and reservations and an atomic way to reserve before signing. A worker-supplied snapshot alone is a worker check.
- **Resize and close.**
  - Use reduce-only buys, and reconcile every fill before the next size decision.
  - Serialize close and resize.
  - Cancel any outstanding entry orders, and verify they're gone before treating the rule as flat.
  - If a partial fill, the venue minimum or a price band blocks completion, keep the residual visible with an owner action.
  - Test a full reduce-only close as the fallback for small excesses.

### Attached recovery stop (revision 8)

Send one `order` action with `grouping: "normalTpsl"`:
- **parent:** the bounded SOL sell, `t.limit.tif: "Ioc"`;
- **child:** a reduce-only buy, `t.trigger: { isMarket: false, triggerPx: recoveryMark, tpsl: "sl" }`. Its limit is the reviewed buyback ceiling, and its size is the parent's size.

Give each leg its own cloid, and journal both before signing. The guard builds and verifies both legs under the same policy. The exact JSON is in section 19.

**What the docs say.**
- After a full parent fill, the child is placed immediately.
- A canceled partial parent loses its child, except when it was canceled for insufficient margin; then the child is placed.
- Verify the IOC-specific behavior on the venue, including a rejected child, before you enable this or claim the stop survives an outage.

[TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl) · [Place an order](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#place-an-order)

- **Full fill.**
  - Check `orderStatus` and `frontendOpenOrders` on the Hedge account for the active child: its trigger, price ceiling, size and reduce-only flag.
  - Show **Recovery stop active** only once confirmed. If it already triggered, track the fills and any remaining short.
- **Partial fill or missing child.**
  - Read the live short and check for an existing exit.
  - If the rule already calls for recovery or expiry, try the reviewed reduce-only close. Otherwise install a position stop for the remaining short, and confirm it.
  - A worker crash before that confirmation can leave an uncovered short. Show **Recovery stop missing** when it's verified absent, and **Checking recovery stop** when the state is unknown.
  - On restart, repair or close based on venue state. If the worker can't repair it, show the owner close.
- **After a resize.**
  - A parent-linked child can have a fixed size, so verify its coverage after a resize.
  - Replace or adjust it only through a tested sequence, with the UI showing any coverage gap.
  - Automated exits stay reduce-only. Reconcile a concurrent stop trigger before sending another close. Confirm the account is flat, with no hedge orders left, before payout.
- **The worker must be online for entry.** If the bracket test fails, use the worker-driven exit and say so in the demo.

## 19. Hyperliquid integration

### API map (revision 8)

| Job | Request or stream | What we take from it |
| --- | --- | --- |
| Market search and context | `POST /info` `{"type":"metaAndAssetCtxs"}` | The default perp universe, numeric asset ID (the index in `universe`), precision, leverage, and the initial mark and funding. |
| Chart | `POST /info` `{"type":"candleSnapshot","req":{coin,interval,startTime,endTime}}`; subscribe to `candle`. | Merge on candle open time. Refill history after a reconnect. Convert milliseconds to the chart's time format at the view boundary. |
| Trigger and execution preview | Subscribe to `activeAssetCtx`, and `bbo` or `l2Book`. | The mark drives hedge triggers. Best bid/ask and depth drive executable price estimates. Label candles, mark and fills separately. |
| Positions and margin | `clearinghouseState` for the actual account; `activeAssetData` for market-specific account data as needed. | Positions, signed size, equity, available margin, liquidation estimate. Resolve the margin mode before showing available funds. |
| Orders and activity | `frontendOpenOrders`; `orderStatus` by `oid` or `cloid`; `userFills`; streams `orderUpdates` and `userFills`. | De-duplicate snapshots and live fills. Pair orders with fills and positions. Always query the owner's address. |
| Send and cancel | `POST /exchange`: `order`, `cancel`, `cancelByCloid` | Manual market orders are a bounded IOC; limit orders are GTC; reduce or close uses `reduceOnly`. Capture both the cloid and the venue oid. |
| Leverage and delegation | `updateLeverage`, `approveAgent` | Re-read the actual leverage and account state afterwards. Agent approval is separate from our policy signature. |

**Observed on Nov 14:** mainnet `meta` returned SOL at **index 5**, with **`szDecimals: 2`** and **`maxLeverage: 20`**. Resolve these from metadata at runtime, for the chosen network.

[Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) · [Perps info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals) · [Asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids) · [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) · [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

### Info calls: request bodies and fields (docs)

All are `POST /info` with `Content-Type: application/json`, using the master address as `user`.

| Call | Body | Key fields |
| --- | --- | --- |
| `meta` | `{"type":"meta"}` | `universe[]`: `name`, `szDecimals`, `maxLeverage` |
| `metaAndAssetCtxs` | `{"type":"metaAndAssetCtxs"}` | `[meta, ctxs[]]`; ctx: `markPx`, `funding`, `openInterest`, `oraclePx` |
| `clearinghouseState` | `{"type":"clearinghouseState","user":"0x…"}` | `marginSummary.accountValue`, `totalMarginUsed`, `totalNtlPos`; `assetPositions[].position`: `szi`, `entryPx`, `liquidationPx`, `marginUsed`; `withdrawable`; `crossMaintenanceMarginUsed` |
| `frontendOpenOrders` | `{"type":"frontendOpenOrders","user":"0x…"}` | `coin`, `limitPx`, `oid`, `side`, `sz`, `origSz`, `orderType`, `reduceOnly`, `isTrigger`, `triggerCondition`, `triggerPx`, `isPositionTpsl`, `timestamp` |
| `openOrders` | `{"type":"openOrders","user":"0x…"}` | Basic fields only. No trigger or TP/SL fields, so use `frontendOpenOrders`. |
| `orderStatus` | `{"type":"orderStatus","user":"0x…","oid":123}` (or a cloid hex string) | `status: "order"` with `order.{children, isTrigger, triggerCondition, triggerPx, isPositionTpsl, reduceOnly, orderType, origSz, tif, cloid}` and `status`. Statuses include `open`, `filled`, `canceled`, `triggered`, `rejected`, `marginCanceled`, `reduceOnlyCanceled`, `perpMarginRejected`. An unknown order returns `{"status":"unknownOid"}`. |
| `userFills` | `{"type":"userFills","user":"0x…","aggregateByTime":false}` | Up to 2,000 recent fills: `coin`, `px`, `sz`, `side`, `time`, `dir`, `closedPnl`, `oid`, `tid`, `crossed`, `fee`, `feeToken`, `builderFee` |
| `userFillsByTime` | `{"type":"userFillsByTime","user":"0x…","startTime":ms,"endTime":ms}` | 2,000 per page, from the 10,000 most recent. Page with the last timestamp. |
| `historicalOrders` | `{"type":"historicalOrders","user":"0x…"}` | Up to 2,000 recent orders, with `children` |
| `candleSnapshot` | `{"type":"candleSnapshot","req":{"coin":"SOL","interval":"1m","startTime":ms,"endTime":ms}}` | `t`, `T`, `o`, `h`, `l`, `c`, `v`, `n`, `i`, `s`. **Only the latest 5,000 candles.** Intervals run from 1m to 1M. |
| `userRateLimit` | `{"type":"userRateLimit","user":"0x…"}` | `cumVlm`, `nRequestsUsed`, `nRequestsCap`, `nRequestsSurplus` |
| `spotMeta` | `{"type":"spotMeta"}` | Token IDs. USDC is `0x6d1e7cde53ba9467b783cb7c530ce054` (observed). |

### WebSocket (docs)

- **Subscribe:** `{"method":"subscribe","subscription":{...}}`.
- **Types:**
  - `candle` (`coin`, `interval`);
  - `allMids`;
  - `l2Book` (`coin`; optional `nSigFigs`, `mantissa`, `fast`);
  - `bbo`;
  - `activeAssetCtx` (`coin`);
  - `orderUpdates`, `userFills` and `userEvents` (`user`; `userEvents` arrives on channel `"user"`);
  - `webData3` (`user`);
  - `clearinghouseState` (`user`).
- **Snapshots:** user streams send a snapshot first, marked `isSnapshot: true`. Merge it with what you've already processed; don't double-count.
- **Reconnects:** subscribe, then merge with a fresh snapshot without dropping events that arrived during it. If the user switches wallet accounts, clear order previews and rebind subscriptions.

### Exchange actions: wire shapes (docs)

Every request is `POST /exchange` with `{ action, nonce, signature, vaultAddress?, expiresAfter? }`. We don't use `vaultAddress`. Use short `expiresAfter` values where supported. The wire shapes below use `5` only as an example. Get the numeric asset ID from the selected network's metadata.

```jsonc
// order
{ "type": "order",
  "orders": [{ "a": 5, "b": false, "p": "137.2", "s": "6", "r": false,
               "t": { "limit": { "tif": "Ioc" } },           // or "Gtc" / "Alo"
               "c": "0x00112233445566778899aabbccddeeff" }],  // optional cloid, 16 bytes hex
  "grouping": "na",                                          // "na" | "normalTpsl" | "positionTpsl"
  "builder": { "b": "0x…", "f": 10 } }                       // optional; f = tenths of a basis point

// trigger order type (for TP/SL legs)
"t": { "trigger": { "isMarket": false, "triggerPx": "161", "tpsl": "sl" } }

// cancel / cancelByCloid
{ "type": "cancel", "cancels": [{ "a": 5, "o": 123456 }] }
{ "type": "cancelByCloid", "cancels": [{ "asset": 5, "cloid": "0x…" }] }

// modify / batchModify (inside "order", "a" is the asset; at top level, "a" means always_place)
{ "type": "modify", "oid": 123456, "order": { "a": 5, "b": true, "p": "161", "s": "5", "r": true, "t": { … } } }

// updateLeverage
{ "type": "updateLeverage", "asset": 5, "isCross": true, "leverage": 10 }

// approveAgent (user-signed; owner)
{ "type": "approveAgent", "hyperliquidChain": "Mainnet", "signatureChainId": "0xa4b1",
  "agentAddress": "0x<guard>", "agentName": "baghedge valid_until <timestamp>", "nonce": 1794666000000 }

// sendAsset (user-signed; owner)
{ "type": "sendAsset", "hyperliquidChain": "Mainnet", "signatureChainId": "0xa4b1",
  "destination": "0x<1Click deposit address>", "sourceDex": "", "destinationDex": "",
  "token": "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", "amount": "24.5", "fromSubAccount": "", "nonce": 1794666000001 }

// approveBuilderFee (user-signed; optional)
{ "type": "approveBuilderFee", "hyperliquidChain": "Mainnet", "signatureChainId": "0xa4b1",
  "maxFeeRate": "0.001%", "builder": "0x…", "nonce": 1794666000002 }

// scheduleCancel: NOT used for expiry (it cancels every order, including the recovery stop)
{ "type": "scheduleCancel", "time": 1794669600000 }
```

**The hedge entry with its attached recovery stop** (revision 8 shape; run the $10 test first):

```jsonc
{ "type": "order",
  "orders": [
    { "a": 5, "b": false, "p": "<entry floor, e.g. 137.2>", "s": "<lots as decimal, e.g. 6>", "r": false,
      "t": { "limit": { "tif": "Ioc" } }, "c": "0x<cloid-entry>" },
    { "a": 5, "b": true, "p": "<buyback ceiling>", "s": "<same size>", "r": true,
      "t": { "trigger": { "isMarket": false, "triggerPx": "<recovery mark, e.g. 161>", "tpsl": "sl" } },
      "c": "0x<cloid-stop>" }
  ],
  "grouping": "normalTpsl" }
```

**Manual orders (revision 8)**
- A market order is a bounded IOC: the limit is mark ± the reviewed slippage.
- A limit order is GTC.
- Reduce and close use `r: true`. To reduce a long, sell; to reduce a short, buy. Cap a reduce-only request at the confirmed remaining position.

**Precision (docs)**
- Sizes round to `szDecimals`. For SOL, with szDecimals 2: `6.04` is valid, `6.045` isn't.
- Prices allow up to 5 significant figures and at most `6 − szDecimals` decimals (4 for SOL). Integer prices are always allowed.
  - So `140.12` is valid, `140.123` has too many significant figures, and `1234.56` would be too.
- Round size down to the lot. Keep price rounding inside the reviewed bound: round a sell floor up and a buy ceiling down, so you never cross the bound.

[Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size)

**Wire strings**
- The signed strings must match the submitted strings byte for byte.
- Normalize like the SDK: round to the venue rules, then strip trailing zeros.
- Keep the field order `a, b, p, s, r, t, c` inside each order, because the msgpack hash depends on it.

**Cloids (proposal):** use the first 16 bytes of `keccak256(ruleId ‖ version ‖ intent ‖ seq)`. Use a separate `intent` for the entry and stop legs. Reconcile an ambiguous submission using the IDs already in the journal. If resending the same action is safe, use the same signed body, nonce, and cloids. After a confirmed zero fill, a new attempt gets a new sequence, cloids, and nonce. For manual orders, use random bytes saved locally before sending.

**Responses**
- An HTTP 200 with `"status":"ok"` can still carry a per-order error in `response.data.statuses[i]`.
- Per-order results look like `resting`, `filled` (with `totalSz` and `avgPx`) or `error`. Parse defensively and confirm through `orderStatus`.

### Signing (docs and Chainstack)

The TypeScript SDK handles signing in the browser and the server. The guard has to do it itself in Rust.

- **L1 actions** (`order`, `cancel`, `cancelByCloid`, `modify`, `updateLeverage`, `scheduleCancel`):
  1. msgpack-encode the action;
  2. append the nonce as 8 bytes big-endian, then `0x00` for no vault (`0x01` plus a 20-byte address if there is one);
  3. if `expiresAfter` is present, append `0x00` followed by the expiry timestamp in milliseconds as 8 bytes big-endian. If absent, append nothing;
  4. `connectionId = keccak256(bytes)`;
  5. sign the EIP-712 struct `Agent { source: string, connectionId: bytes32 }`, with `source` `"a"` on mainnet and `"b"` on testnet. The domain is `{ name: "Exchange", version: "1", chainId: 1337, verifyingContract: 0x0000000000000000000000000000000000000000 }`;
  6. split the result into `{ r, s, v }`.
- **User-signed actions** (`approveAgent`, `sendAsset`, `approveBuilderFee`, withdrawals):
  - Domain: `{ name: "HyperliquidSignTransaction", version: "1", chainId: <signatureChainId as a number>, verifyingContract: 0x0 }`.
  - Primary type `HyperliquidTransaction:ApproveAgent`, with `hyperliquidChain: string`, `agentAddress: address`, `agentName: string` and `nonce: uint64`.
  - Use the SDK for `sendAsset`'s typed data.
- **Connected-wallet check (revision 8).**
  - The SDK's `signatureChainId` defaults to the browser provider's active chain, and `hyperliquidChain` follows the venue environment.
  - Check the account and the provider chain at signing time, and record the wallet and chain that worked.
  - Prove `approveAgent` with a connected EVM wallet on a dedicated Hedge test account, then owner-signed `sendAsset` in the funding round trip.
- **Golden vectors.** Generate fixed vectors (action → msgpack hex → connectionId → signature) from the official SDK with and without `expiresAfter`. Make the TypeScript and Rust paths reproduce them, and compare the recovered signer. A change to a signed field, including expiry, must fail verification.

Start with this unsigned hash vector. Asset ID `0` is a fixture value. Do not submit it as an order.

```json
{"type":"order","orders":[{"a":0,"b":false,"p":"140","s":"0.1","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"}
```

With nonce `1794666000000` and no vault, the official SDK returns:

| `expiresAfter` | `connectionId` |
| --- | --- |
| Omitted | `0x05cede95adc1f93d2097439b1d4ec0d5ae7e002e02a6881d9bc842b5a6d7aa53` |
| `1794666005000` | `0x834ba2dace98eccc2436d18abe35f66b07e39a63bfc88b85aa628e4032b70110` |

[L1 action signing](https://docs.chainstack.com/docs/hyperliquid-l1-action-signing) · [User-signed actions](https://docs.chainstack.com/docs/hyperliquid-user-signed-actions) · [Debugging signature errors](https://docs.chainstack.com/docs/hyperliquid-debugging-signature-errors) · [SDK signing](https://nktkas.gitbook.io/hyperliquid/signing) · [SDK browser wallets](https://nktkas.gitbook.io/hyperliquid/guides/browser-wallets) · [Official signing.py](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py) · [Hyperliquid signing notes](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing)

### Nonces and agents (docs)

- **Nonce storage.** Hyperliquid stores the **100 highest nonces per signer**. A new nonce must be bigger than the smallest of them, never used before, and inside **(T − 2 days, T + 1 day)**, where T is the block time in milliseconds.
- **Nonce allocation.** Give out nonces per signer, monotonically: `max(nowMs, last + 1)`.
- **Agents per account.** One **unnamed** agent and up to **three named** agents. Approving a new unnamed agent prunes the old unnamed one, and the same goes for a named agent with a matching name. So use a unique name for the guard.
- **Expiry.** Write it as `valid_until <timestamp>` after the agent name, up to 180 days out. Check the timestamp unit with a test.
- **Pruning.** An agent is pruned when it's deregistered, expires, or its account has no funds. Pruned nonce state can make old signed actions replayable, so use a new agent address on rotation.
- **What agents can sign.** The venue allows orders, cancels, leverage changes, and `agentSendAsset` between balances at the same address. Owner authorization is needed for third-party transfers, withdrawals, and agent approvals. Baghedge's guard refuses all transfer and leverage actions. The Hedge owner sets leverage during account setup.

[Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets) · [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)

### TP/SL facts (docs)

- **Trigger price.** The mark price triggers TP/SL orders.
- **Position TP/SL.** Opened from the position form, it sizes to the whole position by default.
- **Parent-attached TP/SL.**
  - Children stay untriggered until the parent fills completely.
  - A partially filled parent that gets canceled cancels its children, unless it was canceled for insufficient margin.
  - Canceling an unfilled parent cancels the children.
- **Slippage.** Market TP/SL orders have a 10% slippage tolerance. Limit TP/SL orders use their limit price.

[TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl) · [Order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)

### Venue numbers (docs)

| Item | Value |
| --- | --- |
| Max leverage → maintenance margin | SOL 20x → 2.5% · BTC 40x → 1.25% · ETH 25x → 2% · HYPE 10x → 5% (maintenance = half the initial margin at max leverage) |
| Fees, base tier | 0.045% taker, 0.015% maker |
| Minimum order | $10 notional |
| Funding | Paid hourly: the premium plus a clamped interest term (0.01% per 8h), capped at 0.5% an hour. When it's negative, shorts pay. |
| ADL ranking | (mark / entry) × (notional / account value). Extra margin lowers a position's rank. |
| Activation | A new account pays 1 USDC on its first incoming transfer |

[Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining) · [Margin tiers](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers) · [Liquidations](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations) · [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) · [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees) · [Auto-deleveraging](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging) · [Activation fee](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/activation-gas-fee)

### TypeScript SDK quick start (docs)

```ts
import { HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";

// The caller supplies the selected network and the Hedge master address.
export async function connectHedge(mode: "testnet" | "mainnet", hedgeAddress: `0x${string}`) {
  const options = { isTestnet: mode === "testnet" };
  const info = new InfoClient({ transport: new HttpTransport(options) });
  const { universe } = await info.meta(); // default perp DEX
  const assetId = universe.findIndex((market) => market.name === "SOL" && !market.isDelisted);
  if (assetId < 0) throw new Error("SOL perp is unavailable on the selected network");

  const socket = new WebSocketTransport(options);
  const subs = new SubscriptionClient({ transport: socket });
  // Use assetId as `a` when building the order. Size and price use the market's precision.
  return { assetId, market: universe[assetId], subs, hedgeAddress, close: () => socket.close() };
}
```

Subscribe with `subs.orderUpdates({ user: hedgeAddress }, onOrderUpdates)` using the Hedge master, not the agent. Close the connection on teardown. Use the browser wallet with `ExchangeClient` for manual Trade orders. The hedge worker rebuilds the action, verifies the guard signature, and submits the same payload. [SDK transports](https://nktkas.gitbook.io/hyperliquid/transports) · [Asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids) · [Browser wallets](https://nktkas.gitbook.io/hyperliquid/guides/browser-wallets)

## 20. Funding and payout (NEAR Intents 1Click)

### Basics (docs)

- **Base URL:** `https://1click.chaindefuser.com`.
- **Endpoints:**
  - `GET /v0/tokens`;
  - `POST /v0/quote`;
  - `POST /v0/deposit/submit` with `{ depositAddress, txHash }`, optional, to speed things up;
  - `GET /v0/status?depositAddress=…`.
- **Auth:** an optional JWT (`Authorization: Bearer …`). Use the returned quote for the estimated cost and delivered amount. Don't infer the no-JWT fee from the difference between the amounts in and out.
- **Statuses:** `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED`.
- **Mainnet only.** Intents has no testnet. Use `dry: true` for previews.

### Assets (1Click token list, Nov 14; recheck at runtime)

| Asset | 1Click ID | Units |
| --- | --- | --- |
| Base USDC (native) | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | 6 decimals; $25 is `25000000` |
| HyperCore perps USDC | `1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054` | 8 decimals in 1Click; $25 is `2500000000` |
| HyperCore `erc20` USDC | `1cs_v1:hypercore:erc20:0xb88339CB7199b77E23DB6E890353E22632Ba630f` | 6 decimals. **Not** the perps route; don't use it. |
| Solana USDC | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | 6 decimals. Validate this route separately before enabling it. |

**Three different USDC IDs; don't mix them up.**
- The Base USDC contract: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` on chain 8453.
- The 1Click asset IDs above.
- The HyperCore token ID, which goes in `sendAsset` as `token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054"` (from `spotMeta`).

[Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

### Quote request fields (docs)

**Required**
- `dry` (boolean);
- `swapType`: `EXACT_INPUT`, `EXACT_OUTPUT`, `FLEX_INPUT` or `ANY_INPUT`;
- `slippageTolerance` (basis points);
- `originAsset` and `destinationAsset`;
- `depositType`, `refundType` and `recipientType`, each `ORIGIN_CHAIN` / `INTENTS` / `CONFIDENTIAL_INTENTS` (`recipientType` uses `DESTINATION_CHAIN` instead of `ORIGIN_CHAIN`);
- `amount`, an integer in the smallest unit;
- `refundTo` and `recipient`;
- `deadline` (ISO).

**Optional**
- `depositMode` (`SIMPLE` or `MEMO`) and `confidentiality`;
- `referral` and `quoteWaitingTimeMs`;
- `appFees: [{ recipient, fee }]`, with `fee` in basis points of `amountIn`;
- `insured` (+2 bps);
- `connectedWallets` and `sessionId`.

**Response**
- Top level: `correlationId`, `timestamp`, `signature` (store it with the quote), `quoteRequest`.
- `quote`:
  - `depositAddress` and `depositMemo`;
  - `amountIn`, `amountInFormatted`, `amountInUsd` and `minAmountIn`;
  - `amountOut`, `amountOutFormatted`, `amountOutUsd` and `minAmountOut`;
  - `deadline` and `timeWhenInactive`;
  - `timeEstimate` (seconds);
  - `refundFee` and `withdrawFee`.
- Dry runs omit `depositAddress`.

[1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request) · [Quote reference](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)

### Both directions (revision 8; start with `EXACT_INPUT`)

| Field | Fund an account from Base | Pay an account out to Base |
| --- | --- | --- |
| `originAsset` → `destinationAsset` | Base USDC → HyperCore USDC | HyperCore USDC → Base USDC |
| `recipient` | The selected Trade or Hedge master address | The reviewed Base recipient |
| `refundTo` | The source wallet on Base | The source master address on HyperCore |
| `depositType` / `recipientType` / `refundType` | `ORIGIN_CHAIN` / `DESTINATION_CHAIN` / `ORIGIN_CHAIN` | Same |
| Source transaction | The Base wallet sends native USDC `transfer(depositAddress, amountIn)` on chain 8453. | The venue owner signs HyperCore `sendAsset` to the deposit address, with `sourceDex: ""`, `destinationDex: ""`, `fromSubAccount: ""`. Verify with an executable quote and receipt. |

```json
{
  "dry": false,
  "swapType": "EXACT_INPUT",
  "slippageTolerance": 100,
  "originAsset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
  "amount": "25000000",
  "refundTo": "0x<user's Base wallet>",
  "refundType": "ORIGIN_CHAIN",
  "recipient": "0x<Hedge or Trade master>",
  "recipientType": "DESTINATION_CHAIN",
  "deadline": "<now + 30 min, ISO 8601>"
}
```

**Payout transfer**
- Sign `sendAsset` for exactly `quote.amountIn`, formatted as a decimal string at the origin asset's precision.
- Don't use `usdSend`; it deducts an extra 1 USDC.
- 1Click takes a flat 0.2 USDC off each transfer into a HyperCore deposit address, with a 0.5 USDC minimum.

[Hyperliquid route](https://docs.near-intents.org/integration/distribution-channels/1click-api/hyperliquid) · [sendAsset](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#send-asset) · [Reference sendAsset](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/exchange.py)

**Quote handling (revision 8)**
- A dry quote is display-only.
- **Before showing "Sign transfer":**
  1. fetch an executable quote;
  2. confirm the direction and addresses;
  3. show `amountIn`, `amountOut`, `minAmountOut`, the review `deadline`, and the refund destination. Keep the provider's `depositDeadline` separate;
  4. save the deposit address and lock the button against double clicks;
  5. recheck the signing account and network right before signing.
- **Expiry.** An expired quote with nothing sent can be replaced. A transaction already sent stays tied to its original quote.
- **After a new account's activation,** check the confirmed usable USDC.

**Route state (revision 8)**
- Save the source transaction hash when known, optionally notify `/v0/deposit/submit`, and poll by deposit address with backoff.
- **Pending:** map `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX` and `PROCESSING` to visible steps.
- **`SUCCESS`:** keep the receipt, then verify usable margin (inbound) or the Base transfer (payout).
- **`INCOMPLETE_DEPOSIT`, `REFUNDED` or `FAILED`:** show the current amount and location if verified, with a link to the route record.
- **Unknown:** a missing status or a timeout stays **Checking transfer**.
- **Refresh:** reopen with the saved route.

[NEAR Intents Explorer](https://explorer.near-intents.org)

**Read-only evidence (observed, Nov 14).** Both $25 dry quotes returned HTTP 201.
- Base → perps quoted 24.682779 USDC out.
- Perps → Base quoted 24.792590 USDC out.
- Use these to test parsers and unit conversions. They're point-in-time, not promises.

## 21. Solana balance reads

**Liquid SOL (revision 8)**
- Use `getBalance(watchedAddress)` and `accountSubscribe`. Subscribe for changes, and re-read from RPC before any open or resize decision.
- Use one commitment level for the execution snapshot. Start with `confirmed` for live tests.
- Carry the slot and observation time for each component.
- A failed read keeps the last confirmed value, marked stale. It contributes an unknown amount; it's never treated as a withdrawal.

**Native stake (revision 8)**
- **Query.** `getProgramAccounts` on the Stake program (`Stake11111111111111111111111111111111111111`), with context and a withdraw-authority filter where the provider supports it.
- **Verify.**
  - Decode the supported stake states, and verify the withdraw authority in the result.
  - Validate the filter and layout against known accounts before enabling it.
- **What counts.**
  - Count delegated and cooling-down SOL the watched address still controls.
  - Exclude rent reserves.
  - Count once when a stake account is withdrawn back to the address.
- **Refresh** discovery periodically and after relevant changes.
- **Fallback.** If the provider can't serve a complete scan, use **Liquid SOL only**, and require a fresh review before changing an armed rule's scope.

**Layout hints (docs; validate them)**
- Stake accounts are 200 bytes (`dataSize: 200`).
- The Solana Cookbook filters by authority at offset 12, which is the staker. The withdrawer should be at offset 44 (12 + 32). Confirm it against known accounts.
- `jsonParsed` exposes `stake.delegation.stake`.

```ts
// server/venues/solana.ts (sketch)
const STAKE = new PublicKey("Stake11111111111111111111111111111111111111");
const liquid = await conn.getBalance(owner, { commitment: "confirmed" });
const stakeAccts = await conn.getParsedProgramAccounts(STAKE, {
  commitment: "confirmed",
  filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: owner.toBase58() } }], // withdrawer (validate)
});
// verify parsed.info.meta.authorized.withdrawer === owner; sum delegation.stake (exclude rentExemptReserve)
```

**JitoSOL and mSOL (optional; revision 8)**
- Read token accounts by owner and verified mint.
- Use raw amounts and the pool's current on-chain SOL rate, and round down before ordering.
- Add one asset at a time, after checking against an independent read.

| Token | Mint and rate source (check on an explorer) |
| --- | --- |
| JitoSOL | Mint `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`; stake pool `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb` (`totalLamports / poolTokenSupply`) |
| mSOL | Mint `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So`; Marinade state `8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC` (mSOL price) |

**Moves between liquid SOL and stake**
- A transfer into native stake can look like a temporary drop if the reads are out of sync.
- Re-read both components at compatible slots, and confirm the drop before resizing.
- In the recorded demo, transfer SOL out of the watched scope.

[getBalance](https://solana.com/docs/rpc/http/getbalance) · [accountSubscribe](https://solana.com/docs/rpc/websocket/accountsubscribe) · [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts) · [getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) · [Stake accounts](https://solana.com/docs/references/staking/stake-accounts) · [Cookbook: staking](https://solanacookbook.com/references/staking.html) · [Helius getProgramAccounts](https://www.helius.dev/docs/rpc/guides/getprogramaccounts) · [Jito programs](https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/) · [Marinade program](https://github.com/marinade-finance/liquid-staking-program)

## 22. The guard (OutLayer signer)

**What it is.** OutLayer is "a verifiable off-chain compute platform for NEAR, built by FastNEAR" ([NEAR docs](https://docs.near.org/primitives/off-chain-compute/outlayer)). Contracts and callers send work to Intel TDX enclaves, which return results with an attestation.

**Today's probe.** The [Rust crate](../guard/Cargo.toml) builds a WASM module that can request a public key or sign a fixed-format challenge. It doesn't sign orders. The planned guard will use an OutLayer `secp256k1` key, approved as a named, expiring agent for the Hedge account, and sign only orders and cancels allowed by the owner's policy.

### Build requirements (docs)

- **Target.** Build a **`wasm32-wasip2` component.**
  - Signing keys only work for P2: "a WASI P1 module that declares keys is refused".
  - HTTP requests (with `wasi-http-client`) also work only on P2.
- **Entry point.** Use `[[bin]]` with `fn main()`, not `[lib]`. A `[lib]` gives "entry symbol not defined: _initialize".
- **I/O.** Read JSON from **stdin** and write JSON to **stdout**, then call `flush()`. Without the flush, output can be empty.
- **Output budget.** Keep guard output at or below **900 bytes**. The WASI guide documents that cap for results returned to NEAR. Confirm the limit for the chosen transport. Return signatures and hashes rather than full actions.
- **The `cabi_realloc` pitfall.** It means the project isn't set up as a P2 component. Start from one of OutLayer's P2 examples rather than dropping to P1, because P1 can't hold keys or make HTTP calls.
- **Limits for HTTPS calls.** Default 1B instructions, 128 MB and 60 s; maximum 500B, 512 MB and 180 s. On-chain calls allow up to 4,096 MB of memory.
- **Build.** Use the local probe commands in the [README](../README.md#outlayer-probe). For a reproducible release, pin the toolchain and add the upstream script, which isn't in the repo yet. Once added, run `./scripts/build_github_wasm.sh --dir ./guard --target wasm32-wasip2 --twice --keep`. Pass `--target` because the script defaults to `wasm32-wasip1`.
- **Publish.** `outlayer upload <wasm>` returns a SHA-256 and a FastFS URL. Use those values for a direct run of the current probe. `outlayer deploy <project> <url>` is for a registered project, which needs a separate build with `bind: "project"`. A project ID looks like `owner.near/name`, and `version_key` pins its WASM hash.

[Getting started](https://app.outlayer.ai/docs/getting-started) · [Building an app (WASI)](https://app.outlayer.ai/docs/wasi) · [Projects](https://app.outlayer.ai/docs/projects) · [Build script](https://github.com/out-layer/outlayer/blob/main/scripts/build_github_wasm.sh)

### The key (docs)

- **Declaring it.** Declare a `secp256k1` signing key in the manifest. The path must match `[a-z0-9][a-z0-9_-]{0,31}` and be unique among the manifest's `signing_keys`.
- **Host calls** (`outlayer:signing-keys`):
  - `public-key(path, vault)` → the public key.
  - `sign(path, vault, message)`. For secp256k1, the message is **exactly a 32-byte prehash**, and it returns 65 bytes, `r‖s‖v`, with `v` 0 or 1. Add 27 for EVM.
  - ed25519 signs raw bytes, up to 65,536.
  - `sign-nep413(…)` also exists.
- **`vault`.** Pass `none` for a key without a vault, or `some("<vault>")` for one with.
- **EVM address.** `0x` plus the last 20 bytes of `keccak256` of the 64-byte uncompressed public key (without the `0x04` prefix).
- **OutLayer's own rule:** "Never sign caller-supplied bytes or digests verbatim." The guard builds every action itself from validated fields.
- **Reference code.** OutLayer's WIT file is `worker/wit/deps/signing-keys.wit`, and the Rust example is `wasi-examples/signing-key-probe/src/main.rs`. Both are linked from the Signing Keys page.

[Signing keys](https://app.outlayer.ai/docs/signing-keys) · [TEE attestation](https://app.outlayer.ai/docs/tee-attestation) · [Storage and atomic writes](https://app.outlayer.ai/docs/storage) · [Secrets](https://app.outlayer.ai/docs/secrets)

### Key binding and invocation (revision 8)

- **Two kinds of key.** OutLayer documents **build-bound keys** for direct WASM runs, and **project-bound keys** for registered projects. The HTTPS endpoint is a **project** call.
- **Derivation.** It includes the **caller** and the build or project. The same payment-key owner with the same path can get the **same key across calls**.
  - Prove you get a distinct signer per Hedge account before onboarding anyone beyond the demo.
  - For the demo, use one dedicated guard key, approved only on the demo Hedge account.
- **Rotation.**
  - A build-bound key changes with every new build, so an update means rotating the agent and getting a fresh approval.
  - With a project-bound key, disclose who can publish a new build under the same key.
- **Rotate to a new agent address,** because Hyperliquid can prune venue nonce state.
- **Use a direct run for the current probe.** Its [manifest](../guard/manifest.json) declares `bind: "wasm"` and `caller: "signer"`. Use the same NEAR signer to derive the same key for that binary. Verify caller identity, state access, and RPC reads before picking the invocation path for live signing.

**HTTPS project call (alternative build only)**

This endpoint cannot invoke the current `wasm`-bound probe. The example applies if you build it with `bind: "project"` and register that binary as a project version. Keep the probe's input format the same.

```bash
curl -X POST "https://api.outlayer.ai/call/<owner>.near/baghedge-guard" \
  -H "X-Payment-Key: <owner:nonce:secret>" \
  -H "X-Compute-Limit: 50000" \
  -H "Content-Type: application/json" \
  -d '{"input": {"operation": "public_key"}, "async": false}'
# 200 → {"call_id","status":"completed","output":"<stdout>","compute_cost","instructions","time_ms","attestation_url"}
```

**Headers**
- `X-Payment-Key` is required.
- `X-Compute-Limit` is optional: USD micro-units, default 10,000 ($0.01), minimum 1,000.
- `X-Attached-Deposit` (optional) pays the project author.
- `X-Wallet-Id` is for wallet connectors.

**Body**
- `input` (passed on stdin);
- `resource_limits`: `max_instructions`, `max_memory_mb`, `max_execution_seconds`;
- `secrets_ref`: `profile`, `account_id`;
- `async`, and `version_key`.

**Attestation.**
- `attestation_url` is `/attestations/by-call/{call_id}` on `https://api.outlayer.ai`. It returns 404 until the worker has uploaded the quote.
- Failed calls have no attestation, and they're still charged.

**Errors**

| Code | Meaning | What to do |
| --- | --- | --- |
| 400 | Bad request | Fix the request. |
| 401 | Bad payment key | Fix the key. |
| 402 | Payment key out of funds | Add funds. |
| 403 | Project not allowed for this key | Check access. |
| 404 | Project or call not found | Check the ID. |
| 408 | Sync call didn't finish in time | Use `async: true` and poll `/calls/{call_id}`. |
| 429 | Rate limited | Back off. |
| 500 | Server fault; the call may still run and be charged | Check the OutLayer call record before retrying. Reconcile any separately submitted venue order by cloid. |
| 503 | Temporary; nothing ran | Retry after `Retry-After`. |

**Testnet:** `https://testnet-api.outlayer.ai`.

[HTTPS API](https://app.outlayer.ai/docs/https-api) · [Payment keys](https://app.outlayer.ai/docs/payment-keys) · [Pricing and limits](https://app.outlayer.ai/docs/pricing)

**On-chain direct run (current probe)**

Pass these JSON arguments to `request_execution` on `outlayer.near` (mainnet) or `outlayer.testnet` (testnet). Use the published probe URL and its exact SHA-256. This is the documented request shape. The repo has only verified the local build so far.

```json
{
  "source": {
    "WasmUrl": {
      "url": "https://example.com/baghedge-guard.wasm",
      "hash": "<sha256 of the published WASM>",
      "build_target": "wasm32-wasip2"
    }
  },
  "input_data": "{\"operation\":\"public_key\"}",
  "resource_limits": {},
  "response_format": "Json"
}
```

- **`source`.** Use `WasmUrl` directly for the checked-in manifest. `Project {project_id, version_key?}` requires a project-bound build, even when the registered version points to a WASM URL.
- **`resource_limits`.** **Always pass it**, even as `{}`. Without it, nothing runs.
- **Other optional fields:** `secrets_ref`, `response_format` (`Text`, `Json` or `Bytes`), `payer_account_id` and `params`.
- **Deposit.**
  - It's dynamic. Estimate it with the view method `estimate_execution_cost(resource_limits, input_len)`, and unused deposit is refunded.
  - The pricing formula is `base_fee + instructions × rate + time_ms × rate`, but the docs list no rates.
- **Results.** They go to a contract callback that you write; OutLayer's example uses `#[private] fn on_outlayer_result` reading `env::promise_result(0)`. The docs don't say what a plain account caller gets back (test).

[NEAR integration](https://app.outlayer.ai/docs/near-integration)

### Guard operations (proposal; revision 8 asks for a narrow set like "sign entry" and "sign reduction")

The probe currently accepts only `public_key` and `sign_challenge`. The venue operations below are planned.

| `operation` | Builds and signs | Must check before signing |
| --- | --- | --- |
| `public_key` | Nothing. The probe returns the derived address and public key. Verify the attestation separately. | — |
| `sign_entry` | The IOC sell and attached reduce-only recovery stop (`normalTpsl`) | Check the policy signature against the pinned Hedge owner, require distinct accounts, and enforce the signed market, per-action size, prices, and opening window. If using `expiresAfter`, it can't outlast either the opening window or rule expiry. The worker also checks policy status, eligible SOL, the cumulative cap, and freshness. |
| `sign_reduce` | a reduce-only IOC buy (resize or close) | `r: true`; size ≤ confirmed short; price ≤ buyback ceiling (or an owner-reviewed fresh price); policy active, or in its post-expiry reduce-only cleanup |
| `sign_stop` | a replacement position stop for the remaining short | reduce-only; trigger = recovery mark; limit ≤ ceiling; size ≤ confirmed short |
| `sign_cancel` | `cancelByCloid` for Baghedge's own hedge orders | the cloids belong to this rule |

**Refuse at the signing boundary:**
- raw digests or bytes;
- the wrong account or market;
- a buy without reduce-only;
- a single sell larger than the signed cap;
- opening after the window or after expiry;
- prices outside the reviewed limits;
- any transfer, withdrawal, agent approval, or leverage change.

**Bind the owner to the agent.** Trust the approved Hedge owner from provisioned configuration or an independently verified venue association. Verify the policy signature against that owner, not just the address named by the policy. Use a dedicated agent for each Hedge account. Hyperliquid executes a master-account agent's orders under the account that approved it, and an order signature without a vault address doesn't include a target master address.

**Worker checks and attestation.** The worker must reject inactive policy versions, stale observations, and cumulative cap breaches, including unresolved sells. Call them guard checks only once the guard reads trusted current state and reserves size atomically. An attestation binds the code and the data it commits to. It doesn't prove that a worker-supplied wallet balance, fill, reservation, or policy version is current. The same distinction applies to cancellations that depend on the worker's order journal.

### Input and output (proposal; keep output under 900 bytes)

```jsonc
// stdin
{ "operation": "sign_entry",
  "env": "mainnet",
  "policy": { /* HedgePolicy fields, section 18 */ },
  "ownerSig": "0x…",                 // EIP-712 over the policy
  "state": { "filledShortLots": "0", "unresolvedSellLots": "0", "reservationId": "r_…" },
  "obs":   { "eligibleLamports": "10000000000", "slot": 312345678, "markE8": "13995000000", "at": 1794666000000 },
  "nonce": 1794666000000,
  "expiresAfter": 1794666005000,
  "cloids": { "entry": "0x…", "stop": "0x…" } }

// stdout: ok
{ "ok": true, "operation": "sign_entry", "agent": "0x…", "n": 1794666000000,
  "expiresAfter": 1794666005000,
  "h": "0x<connectionId>", "r": "0x…", "s": "0x…", "v": 27, "sz": "6", "px": "137.2" }

// stdout: refusal
{ "ok": false, "operation": "sign_entry", "reason": "price_out_of_bounds" }
```

The worker rebuilds the exact action from the same fields and recomputes `h` using section 19's official SDK layout. For these master-account orders, the hash input is `msgpack(action) ‖ nonce_u64_be ‖ 0x00`. When `expiresAfter` is present, append `0x00 ‖ expiresAfter_u64_be` before hashing. Verify the recovered signer against the expected agent and submit the same nonce and expiry.

### Rust skeleton (proposal)

```rust
// guard/src/main.rs
use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("stdin");
    let out = match serde_json::from_str::<Request>(&input) {
        Ok(req) => handle(req),                      // ops.rs: validate → build action → hash → sign
        Err(e) => Response::refuse("bad_input", &e.to_string()),
    };
    let s = serde_json::to_string(&out).unwrap();
    assert!(s.len() <= 900, "output exceeds guard budget");
    let mut stdout = io::stdout();
    stdout.write_all(s.as_bytes()).unwrap();
    stdout.flush().unwrap();                         // required, or output may be empty
}
```

```toml
# guard/Cargo.toml (sketch; check versions against OutLayer's P2 examples)
[package]
name = "baghedge_guard"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "baghedge_guard"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rmp-serde = "1"          # msgpack (field order matters; match the official SDK bytes)
sha3 = "0.10"            # keccak256
k256 = { version = "0.13", features = ["ecdsa"] }   # recover the owner's EIP-712 signer
hex = "0.4"
bs58 = "0.5"
# wasi-http-client: only if the guard reads RPCs itself; match OutLayer's P2 examples
# signing-keys bindings: generated from OutLayer's WIT (see signing-key-probe)
```

```toml
# guard/rust-toolchain.toml: pin it, because the wasm hash depends on it
[toolchain]
channel = "1.85.0"
targets = ["wasm32-wasip2"]
```

**Reference examples** ([list](https://app.outlayer.ai/docs/examples)):
- [eas-attestor](https://github.com/out-layer/eas-attestor): signs EVM data in-guest, uses an RPC quorum over HTTP, targets Base. It's the closest to our guard.
- [oracle-example](https://github.com/out-layer/oracle-example): HTTP price reads.
- [botfather-example](https://github.com/out-layer/botfather-example) and [intents-example](https://github.com/out-layer/intents-example): signing keys.
- [eth-proof-example](https://github.com/out-layer/eth-proof-example): RPC over HTTP.

For Hyperliquid signing in Rust, see [hyper-exchange signing.rs](https://docs.rs/hyper-exchange/0.1.0/src/hyper_exchange/signing.rs.html) and the official [signing.py](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py).

### Prove the guard against the real venue (revision 8)

1. **Build the component.**
   - Build a `wasm32-wasip2` component that returns a public key and exposes the narrow operations.
   - Declare the `secp256k1` key in the manifest.
   - Rebuild the Hyperliquid L1 action hash and signing domain, and compare the order bytes, digest and recovered signer against the official SDK, using fixed vectors.
2. **Pick the invocation path and verify it** (key binding, caller, trusted state, RPC reads). For a project-bound prototype, disclose the publisher's upgrade authority and check the attested WASM hash.
3. **Provision the key.** Use a dedicated guard key. Verify its attestation and expected caller, pin the intended Hedge owner in trusted configuration, and approve that agent only on the dedicated demo Hedge account.
4. **Reserve before signing.**
   - Set a durable reservation before issuing a signature, with compare-and-swap at the signing boundary if the invocation supports it ([storage](https://app.outlayer.ai/docs/storage)).
   - If only SQLite and worker observations enforce pending size and freshness, document that split: the guard enforces the signed fields, and the worker enforces cumulative reservations and live observations.
5. **Record the evidence.**
   - Record the approved agent address, WASM hash, invocation ID or NEAR receipt, and attestation result.
   - Submit a small order as the agent, and check the fill on the Hedge master account. Verify one invalid request is refused, and record the latency.
   - Keep credentials and reusable signed requests out of public logs.

**Fallback.** If the enclave path isn't available, use a server-held, narrowly scoped agent, for a separately labeled demonstration only. Say who controls the key, and which checks that run used.

## 23. Margin and risk math

**Check the venue state first.** Check the margin mode, leverage, free collateral, current tier, and the collateral assigned to the position. With isolated margin, verify the allocated amount: spare account USDC doesn't raise isolated position margin.

```text
required margin >= max(initial margin,
                       q × (stressed exit price − stressed entry fill)
                       + maintenance at stressed exit price)
                   + cost and execution buffer
```

**The trap**
- The "efficient" margin, `gap + maintenance × (1 + gap)`, leaves the account exactly at maintenance at the recovery price.
- Any delay or slippage there, and Hyperliquid liquidates before the exit fills.
- Always add a buffer. Each extra 1% of notional moves liquidation about 1% of the entry price higher.

**Illustration** (base tier, before costs; revision 8 numbers)

| Item | Value |
| --- | --- |
| Short | 6 SOL filled at $140 = $840 notional |
| At a $161 mark | Loss $126; maintenance at 2.5% ≈ $24.15 |
| Margin ≈ $150 | Liquidation sits right at the recovery level |
| Margin ≈ $192 (+$42 buffer) | Liquidation estimate ≈ $167.80, about 4% above recovery |

- The 6 SOL in the wallet gains about $126 over the same move, but that gain can't pay Hyperliquid margin.
- Show the quoted deposit, the amount posted, and the estimated cost separately.
- A gap, a missed fill, funding or ADL can change the outcome.

**Leverage on the Hedge account (proposal; check the margining docs)**
- With cross margin on the dedicated account, set leverage high enough to pass the initial-margin check on entry.
- In cross mode, liquidation depends on account value against maintenance margin, not on the leverage setting.

**Costs per cycle (estimates)**
- Trading fees: 0.045% taker on each side.
- Route costs:
  - Base → perps: a $25 dry quote returned $24.68. The quote doesn't isolate an authentication surcharge.
  - Perps → Base: $25 returned $24.79, from 1Click's 0.2 USDC flat fee plus the rest.
- A 1 USDC activation fee on a new account.
- Variable funding.

**ADL.** On Oct 10, 2025, auto-deleveraging closed about $2.1B of positions in 12 minutes ([arXiv 2512.01112](https://arxiv.org/abs/2512.01112)). ADL closes profitable, leveraged positions first, and a hedge in a crash is exactly that. Baghedge reports a venue close as an exposure change and offers a fresh **Re-hedge** review. It never re-opens on its own.

## 24. Security and trust boundary

| Actor | Can | Can't |
| --- | --- | --- |
| Owner (Hedge EVM wallet) | Fund, approve or revoke agents, sign the policy, close or cancel directly on Hyperliquid, withdraw | — (takes the venue and margin risk on the funded Hedge account) |
| Guard (enclave agent, planned) | Sign hedge orders and cancels for the bound account under the policy | Sign transfers, withdrawals, agent approvals, or leverage changes. The guard must refuse same-address transfers even though Hyperliquid accepts them from agents. |
| Worker (server) | Observe, schedule, reserve, call the guard, submit signed actions, call 1Click | Hold owner keys. Sign venue actions on its own (except the labeled fallback). |
| Browser | Sign manual Trade orders and owner actions with connected wallets | Act after it's closed |
| 1Click | Route USDC between Base and HyperCore | Touch Hyperliquid positions |

**Remaining risks to disclose**
- **A compromised signer.** It can't move funds out, but it could trade the Hedge account's margin away against a thin market. The dedicated account caps that loss at the margin posted.
- **Platform trust.** The venue, the enclave platform, the price source (Hyperliquid mark), the truthfulness of RPC data, and gaps.
- **ADL** and funding.

**Refusal cases to demo or test**
- the wrong market;
- a buy without reduce-only;
- an oversized sell;
- a cumulative cap breach across two individually valid sells, attributed to whichever component actually verifies the current reservations;
- an expired opening authority;
- a price outside the bounds;
- a transfer request;
- a forged policy signature;
- a stale policy version.

---

# Part D: Plan, tests, demo, submission

## 25. Team split and parallel tracks

| Owner | Deliverable | Acceptance (revision 8) |
| --- | --- | --- |
| 1. Terminal UI | Market search, chart, manual ticket, positions, orders, funds | Place, cancel and close a Trade order in Baghedge. Existing orders and positions load after reconnect. |
| 2. Hedge UI | Rule editor, signed review, exposure, resize, close, settlement | A user connects a watched wallet and follows a rule from entry to payout in the same terminal. |
| 3. Hyperliquid integration | Market data, manual actions, hedge orders, account reconciliation | Manual and hedge fills confirmed on separate accounts. A partial, a rejection and an unknown send all recover. |
| 4. Guard | OutLayer signing, key and build verification, rule enforcement, refusals | The approved guard signs a venue-accepted hedge order. The refusal checks cover cumulative size and non-trade actions. |
| 5. Worker and state | Rule lifecycle, persistence, expiry, recovery | A restart after an ambiguous send doesn't duplicate the entry. Resize and close are serialized. Residual exposure is reported. |
| 6. Intents and Solana | Quote and settlement both ways; wallet and stake reads | Base credit and payout have receipts. Wallet reads match checked accounts, including transfers. |
| 7. Verification and demo | Fixtures, evidence table, no-wallet run, README, video | The full two-mode sequence and one failure reproduce. Every live claim links to its receipt. |

**Integration checks that can run in parallel**

- **Terminal.** Load SOL, connect a dedicated Trade **testnet** account, and get one order through the browser ticket. Confirm the fill, then close it.
- **Guard.**
  - Prove browser-wallet `approveAgent` early.
  - Get the OutLayer public key and attestation. On a dedicated Hedge account, confirm one mainnet fill from the approved signer, plus one policy refusal.
  - Test the exact IOC-plus-attached-exit order shape early, on testnet where feasible. Record zero, full and partial fills, and confirm the child with the worker stopped.
  - Use an order above the venue minimum for the mainnet proof. Record the environment, guard build hash, parent and child IDs, and fill.
- **Funding.** Start with the dry quotes, then verify a small Base → HyperCore credit and a HyperCore → Base payout using connected-wallet `sendAsset`. Confirm usable margin, and save both receipts.

**Milestones (revision 8)**

| # | Milestone is verified when you can show |
| --- | --- |
| 1 | Terminal shell and replay state: market search and candles work; both tickets and the exposure panel render the same deterministic fixture. |
| 2 | Read and trade on Hyperliquid: connect a Trade account, place and cancel a limit, open SOL, reload, then reduce or close. Start on testnet. |
| 3 | Fund and withdraw: dry quotes both ways, then a small Base-to-perps credit and a perps-to-Base payout. Prove it for a fresh account before claiming first-use funding. |
| 4 | Worker and guard: link a distinct Hedge account, prove one guard-signed order and one refusal, and record which checks ran inside OutLayer and which rely on the worker. |
| 5 | The full flow: a manual long, a triggered hedge, a Solana transfer, a confirmed resize, two closes and the Base receipt. Then the same sequence with no wallets, in replay mode. |

Choose sizes that clear the $10 venue minimum, even for the resize.

## 26. Venue experiments ($10 tests)

Run these with dedicated accounts, and record the environment, IDs and outcome for each.

| # | Experiment | Pass when |
| --- | --- | --- |
| V1 | Manual limit place and cancel, IOC open, reduce-only close (testnet first) | The UI matches the venue after a reload |
| V2 | Connected-wallet `approveAgent` (named, with `valid_until`) on a Hedge test account | The venue shows the agent for the intended owner. Record the wallet and chain used. |
| V3 | OutLayer `public_key` plus attestation, then a guard-signed order above $10 on mainnet | The fill shows on the Hedge master account; one invalid request is refused |
| V4 | The IOC parent with an attached reduce-only stop (`normalTpsl`) | Record a zero fill, a full fill with the child active, a partial fill (child absent or present), a rejected child, the child staying active with the worker stopped, and coverage after a resize |
| V5 | (Optional, Claude's suggestion) A standalone reduce-only stop-limit buy at the recovery price, sized to the cap, sent with the entry | If Hyperliquid accepts a reduce-only trigger with no position and trims it to the actual position when it fires, any fill size is covered and the partial-fill gap closes. If it's rejected, keep the revision 8 plan. |
| V6 | 1Click dry quotes both ways, a Base → perps credit (fresh account, activation), and a perps → Base payout via `sendAsset` | Usable margin is confirmed, and both receipts are saved |
| V7 | Stake discovery with the withdraw-authority filter, validated against known accounts | The amounts match an explorer, rent reserve excluded |
| V8 | Margin mode and leverage after a fill; resize and close at minimum sizes | The residual handling works |
| V9 | (Experiment only) A resting venue entry | Documented. Not the baseline. |

## 27. Release-candidate checks (revision 8)

- **Manual orders.** A resting order canceled; a confirmed fill; a partial; a reduce-only close. Live exposure restores after a reload.
- **Accounts.** A wrong or aliased account is rejected. The manual SOL position and its margin stay unchanged through hedge entry, resize and close.
- **Wallet reads.** Fresh and stale reads; liquid-to-stake moves; a transfer out during opening or closing. Verify an LST quantity against its conversion source before claiming support.
- **Entry.** One qualifying crossing; arming when the price has already crossed; zero or partial fills; expiry before and after entry; a gap outside the price band.
- **Cap and policy.** The cumulative cap across two valid sells; a duplicate policy submission; concurrent requests; stale data; an invalid action; an agent rotation.
- **Worker outages.** After arming; after a full fill with a confirmed child; after a partial fill with no active stop. The UI shows actual active orders, uncovered exposure, and the owner's recovery path. Verify child coverage after a resize separately.
- **Funding.** An incomplete deposit or refund; a confirmed credit to the right account; a Base payout from the selected account. Margin principal stays out of P&L.
- **ADL and liquidation.** A replay shows the new exposure and asks for review before any re-hedge. A partial venue close can leave remaining exposure.

## 28. Replay fixtures and evidence

**The main replay (revision 8)**
1. Start with 10 eligible SOL, distinct accounts, a 2 SOL manual long, entry $140, recovery $161 and a 6 SOL cap.
2. The opening mark is above $140.
3. A crossing and a short fill.
4. A confirmed move of 5 SOL out of scope, with a temporarily pending resize.
5. A confirmed 1 SOL buyback.
6. Closing fills, and a completed payout.

Run the same fixtures through the reducer and the UI.

**Failure runs**
- **Timeout:** the venue accepts the entry, then the response times out. The restart must not send a second sell.
- **Gap:** the price gaps with no entry fill. The UI must report zero hedge.
- **ADL:** a venue close changes the exposure and offers a Re-hedge review.

| Integration | Evidence to save |
| --- | --- |
| Trade | Environment, account, market, cloids and oids, timestamps, fill sizes, confirmed close. Also one separate limit-and-cancel sequence. |
| Intents and funding | Direction, assets, quote and deposit ID, requested vs credited amount, source tx, route status, final receipt |
| Phantom and resize | Watched address, transfer signature, slot-tagged before and after reads, the reduce-only order and fill, the unchanged manual position |
| Signer | Guard public key, approved account, build hash, invocation ID or receipt, attestation result, one refused request |
| Recovery | Which action was pending, the reconciliation result, and the final positions. Label manufactured events as fixtures. |

**Explorers:**
- [BaseScan](https://basescan.org/)
- [Solana Explorer](https://explorer.solana.com/)
- [NEAR Intents Explorer](https://explorer.near-intents.org/)
- [Hyperliquid info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [OutLayer attestation](https://app.outlayer.ai/docs/tee-attestation)

**After a live demo:** reconcile all positions and pending orders on both accounts, disarm the hedge, and confirm the payout.

**Oct 10 data.** `candleSnapshot` only keeps the latest 5,000 candles, so get 1-minute data from Hyperliquid's [historical data](https://hyperliquid.gitbook.io/hyperliquid-docs/historical-data) (requester-pays; the docs warn data may be missing). Otherwise use a labeled stand-in. Model ADL from the published figures, and label it as modeled.

## 29. Demo (90 seconds; revision 8)

| Time | Show | Proof |
| --- | --- | --- |
| 0–10 s | Open Baghedge and search **SOL-PERP**. Show the candles, the **Trade** ticket and **10 SOL in Phantom**, and say why the holder wants to keep their SOL through the event. | Live market data, the watched wallet, the Trade account label |
| 10–26 s | Place a **2 SOL long** from Trade. Show the fill in Positions and **12 SOL net long**. | The Trade order and fill |
| 26–43 s | Switch to **Wallet Hedge** on the same chart. Set a **6 SOL** rule, fund the Hedge account from Base through NEAR Intents, and arm. | The route credit, the distinct account, the signed rule. Timestamped cuts are OK. |
| 43–55 s | The mark crosses: a confirmed **6 SOL short**, and **6 SOL net long** across both accounts. | The hedge entry order and fill, with the manual long still visible |
| 55–72 s | Transfer **5 SOL** out of Phantom. Show **Buyback pending**, then the **1 SOL reduce-only fill**: **0 SOL net in the watched wallet**, **2 SOL net long across accounts**. | The Solana transfer, the hedge buyback, the unchanged manual position |
| 72–90 s | Close the hedge, close the long from Positions, and show Hedge USDC returning to Base. End on the repo and the replay command. | Separate confirmed closes and the destination transfer |

**Voiceover**
> I open a SOL long in Baghedge. Now I switch to Wallet Hedge on the same chart. I've got SOL in Phantom, so I set a rule for how much to hedge and fund the short through NEAR Intents. Here's the short next to my trade. When I move SOL out of Phantom, Baghedge buys back the excess. My long is still there, and I can see exactly how much SOL exposure I have left. I can close both positions here and send my hedge margin back to Base.

**Recording rules**
- Recording sizes can be smaller, as long as every order clears the minimum.
- Recompute the overlay from confirmed values.
- If the crossing is replayed, label it, and link the separate real entry and close receipts.
- Keep the outage, rebound and Oct 10 ADL scenarios for the reviewer walkthrough.

## 30. Judging and the README

**How judging works**
- **Criteria** (FAQ): technical implementation, design, impact, originality and sustainability.
- **AI screen:** Claude Code and Codex screen every project first, checking that it runs and does what the README says. Humans decide the winners.
- **Judges:** Illia Polosukhin, Eddy Lazzarin, Mert Mumtaz, Avichal Garg, Kain Warwick, Haseeb Qureshi and Stepan Gershuni.

[Judging FAQ](https://nearhackathon.com/#faq)

| What a judge looks for | What to show (revision 8) |
| --- | --- |
| Technical implementation | Separate Hyperliquid accounts, two-way Intents settlement, a signed hedge policy, recovery after a partial or unknown result. Attestation plus a venue receipt for an enclave claim. |
| Design and usability | A real manual trade before the hedge, one chart, clear signing prompts, exposure from confirmed data |
| Practicality and impact | A SOL holder goes from the market view to closed positions and USDC back. Show the margin they need. |
| Originality | The user moves SOL in Phantom; only the hedge shrinks, and the manual long stays |
| Sustainability | The disclosed builder-code fee hypothesis, plus a demand test with real hedgers |

**README skeleton (reviewer entry point)**
1. The pitch, and the **no-wallet replay**: `bun install && bun run demo:replay`.
2. Exact run and test commands, prerequisites, environment variable names, expected results.
3. Two walkthroughs: a new user, and the 90-second scenario.
4. An evidence table. Pair each user-visible claim with:
   - a venue order or fill;
   - a Solana or Base transaction;
   - an Intents status;
   - a guard attestation;
   - or a labeled replay.
5. Account authority, cancellation and expiry, and who can recover from an outage.
6. Limits and future work. Mark aspirational features clearly.
7. Libraries, pre-existing code (a README section linking the diff, if you reuse an existing repo), other projects the team submits.
8. License (MIT is fine).

## 31. Submission checklist (HACKATHON.md, checked Nov 14)

**Deadlines and repo**
- **Cutoff:** 2026-11-14 23:59 UTC (Nov 15, 05:29 IST). Judging starts Nov 16; results by Nov 18.
- **Repo:** it can be private while building, but must be **public by the cutoff and stay public through judging**. Add a LICENSE.
- **Work window:** Oct 19 to Nov 14. Earlier commits are baseline. An existing repo is allowed if the new work is separated, with a README section linking the diff.

**README and demo**
- **README:** what the product is, the problem it solves, and how to try it as "do X → see Y" steps a judge can follow. List libraries.
- **Demo:** a reproducible local demo with a video is accepted. A hosted demo is a plus; keep it up until at least Nov 18, ideally Nov 25. Screenshots aren't enough when judges can't open the demo.
- **X post:** it must say the project was built at NEAR HACKATHON and tag `@NEARProtocol` and `#NEARHackathon`, with a video. `@NearLegion` and `@NearBuilders` are optional.

**The form** ([apply](https://nearhackathon.com/#apply))
- Project name (2–80 characters) and team lead.
- Contact email (max 160 characters).
- Team size: **`6 - 8`** for seven people.
- Track IDs.
- A NEAR mainnet payout account (named, or a 64-character implicit account).
- The public repo URL and the public demo post URL.
- The description (20–2,000 characters).
- The consent checkbox.
- One submission per project. Fix mistakes through [request changes](https://nearhackathon.com/request-changes).

**Limits and costs**
- One person can lead at most 2 different projects, and an email can make at most 2 submissions.
- Testnet is fine in general, but Intents has no testnet. Mainnet costs aren't reimbursed by default.

**Tracks (IDs)**

| Track | ID |
| --- | --- |
| Unstoppable DeFi (**primary**) | `defi` |
| Investment Thesis | `thesis` |
| Privacy & Private AI | `privacy` |
| Autonomous Business | `business` |
| AI Swarms | `swarms` |
| AI Security & Defense | `security` |
| Agent Economy | `agents` |
| Real-World Money | `realworld` |
| Games With Real Economies | `games` |
| NFTs That Do Something | `nfts` |
| Memecoins With Mechanics | `memecoins` |
| Social Money | `social` |
| Open Innovation | `open` |

**Prizes:** $250k in NEAR; a $55k grand prize; $10k / $3k / $2k per track.

**Submission description (revision 8; use once the matching features have evidence)**
> Baghedge is a Hyperliquid trading terminal. You can search markets, read candles, place long or short orders, and manage positions inside the app. Switch to Wallet Hedge on the same chart to hedge SOL held in Phantom. You pick the size, entry, recovery, and end time. NEAR Intents moves USDC from Base into a separate Hedge account and back. When the watched SOL balance falls below the short, Baghedge buys back the excess and updates your net SOL exposure. The demo shows a manual SOL long, the separate hedge, and the hedge resizing after SOL moves out of Phantom.

**Demo post (revision 8)**
> Built Baghedge at NEAR HACKATHON. Trade perps on Hyperliquid and hedge the SOL you already hold in Phantom, from the same terminal. In the demo, I open a long, fund a separate short through NEAR Intents, and move SOL out of Phantom. The short shrinks and my long stays open. @NEARProtocol #NEARHackathon

Attach the video, the public repo and the replay link.

## 32. Open checks

**From revision 8**
1. Manual wallet signing and connected-wallet `approveAgent`; distinct-account setup; direct owner recovery.
2. Base-to-perps activation and credit, and a connected-wallet `sendAsset` payout, with complete receipts.
3. A build-bound OutLayer key; the chosen caller and account binding; trusted state and RPC freshness; one accepted mainnet order. Also the projected compute cost at the chosen call frequency.
4. Stake discovery and authority, including unbonding balances. JitoSOL and mSOL conversion before counting them.
5. Margin mode and the buffer allocated after a fill. Resize and close at minimum sizes. For the IOC bracket: a full fill with the child active; a partial with the child absent or present; a rejected child; coverage after a resize. Note which cases only ran in replay.
6. Regional access constraints for a public deployment. Venue and app availability can differ.

**Added in this file**

7. Whether OutLayer's 900-byte output cap applies to your chosen invocation path.
8. The timestamp unit in `valid_until` for agent names.
9. If you use on-chain `request_execution` from a plain account: whether the output appears in the transaction result.
10. V5: whether a standalone reduce-only trigger is accepted with no position.
11. OutLayer cost per call: `estimate_execution_cost`, and setting `X-Compute-Limit`.

## 33. Glossary

| Term | Meaning |
| --- | --- |
| Master account | A Hyperliquid account owned by an EVM address. Info queries must use this address. |
| Agent / API wallet | A key approved by a master account for venue actions. Hyperliquid allows same-address transfers, but the Baghedge guard must refuse them. |
| L1 action | An exchange action signed through the "phantom agent" EIP-712 scheme (chainId 1337) |
| User-signed action | `approveAgent`, `sendAsset` and the like, signed with the `HyperliquidSignTransaction` domain and `signatureChainId` |
| Mark price | Hyperliquid's robust price index, used for TP/SL triggers and our hedge triggers ([mark prices](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices)) |
| `szi` | Signed position size from `clearinghouseState`. A short is negative. |
| oid / cloid | The venue order ID, and our 16-byte client order ID |
| IOC / GTC / ALO | Immediate-or-cancel / good-til-canceled / add-liquidity-only |
| `normalTpsl` | A grouping where TP/SL children attach to a parent order and activate when it fills completely |
| `positionTpsl` | TP/SL tied to the whole position |
| Reduce-only | An order that can only shrink a position |
| ADL | Auto-deleveraging: the venue force-closes profitable, leveraged positions to cover losses |
| HyperCore | Hyperliquid's core L1 state (perps and spot balances) |
| 1Click | NEAR Intents' REST API for cross-chain swaps. A deposit address per quote. |
| OutLayer | NEAR's verifiable off-chain compute (Intel TDX), built by FastNEAR |
| Attestation | A TDX proof of which code ran, with which inputs and outputs |
| Build-bound / project-bound key | OutLayer signing keys derived per build (direct WASM run) or per registered project |
| Eligible SOL | The liquid SOL plus verified native stake counted for the watched address (LSTs later) |
| Lot | The minimum size step: 10^-szDecimals (0.01 SOL) |

## 34. Link index

**Hyperliquid docs**
- [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint) · [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) · [Perps info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals) · [Spot info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot) · [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids) · [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size) · [Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets) · [Signing](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing) · [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) · [Error responses](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses) · [Activation fee](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/activation-gas-fee)
- [Order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types) · [TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl) · [Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining) · [Margin tiers](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers) · [Liquidations](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations) · [Auto-deleveraging](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging)
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) · [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees) · [Mark prices](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices) · [Sub-accounts](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/sub-accounts) · [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) · [Historical data](https://hyperliquid.gitbook.io/hyperliquid-docs/historical-data)

**Hyperliquid SDKs and signing**
- [@nktkas/hyperliquid](https://nktkas.gitbook.io/hyperliquid) · [SDK browser wallets](https://nktkas.gitbook.io/hyperliquid/guides/browser-wallets) · [SDK signing](https://nktkas.gitbook.io/hyperliquid/signing) · [Chainstack SDK guide](https://docs.chainstack.com/docs/hyperliquid-typescript-sdk-nktkas)
- [Chainstack L1 signing](https://docs.chainstack.com/docs/hyperliquid-l1-action-signing) · [Chainstack user-signed actions](https://docs.chainstack.com/docs/hyperliquid-user-signed-actions) · [Chainstack signature debugging](https://docs.chainstack.com/docs/hyperliquid-debugging-signature-errors)
- [Official Python signing.py](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py) · [Official exchange.py](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/exchange.py) · [Python SDK examples](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/tree/master/examples) · [Rust signing.rs (hyper-exchange)](https://docs.rs/hyper-exchange/0.1.0/src/hyper_exchange/signing.rs.html)

**OutLayer**
- [NEAR docs: OutLayer](https://docs.near.org/primitives/off-chain-compute/outlayer) · [Getting started](https://app.outlayer.ai/docs/getting-started) · [Building an app (WASI)](https://app.outlayer.ai/docs/wasi) · [Signing keys](https://app.outlayer.ai/docs/signing-keys) · [HTTPS API](https://app.outlayer.ai/docs/https-api) · [NEAR integration](https://app.outlayer.ai/docs/near-integration)
- [Projects](https://app.outlayer.ai/docs/projects) · [Storage](https://app.outlayer.ai/docs/storage) · [Secrets](https://app.outlayer.ai/docs/secrets) · [Payment keys](https://app.outlayer.ai/docs/payment-keys) · [TEE attestation](https://app.outlayer.ai/docs/tee-attestation) · [Pricing and limits](https://app.outlayer.ai/docs/pricing)
- [Examples](https://app.outlayer.ai/docs/examples) · [Build script](https://github.com/out-layer/outlayer/blob/main/scripts/build_github_wasm.sh) · [eas-attestor](https://github.com/out-layer/eas-attestor) · [oracle-example](https://github.com/out-layer/oracle-example)

**NEAR Intents (1Click)**
- [Quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request) · [Quote reference](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) · [Hyperliquid route](https://docs.near-intents.org/integration/distribution-channels/1click-api/hyperliquid) · [Transfer methods](https://docs.near-intents.org/integration/distribution-channels/1click-api/hyperliquid#transfer-methods)
- [Token list](https://1click.chaindefuser.com/v0/tokens) · [Intents Explorer](https://explorer.near-intents.org) · [Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures) · [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

**Solana**
- [getBalance](https://solana.com/docs/rpc/http/getbalance) · [accountSubscribe](https://solana.com/docs/rpc/websocket/accountsubscribe) · [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts) · [getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) · [Stake accounts](https://solana.com/docs/references/staking/stake-accounts)
- [Cookbook: staking](https://solanacookbook.com/references/staking.html) · [Helius getProgramAccounts](https://www.helius.dev/docs/rpc/guides/getprogramaccounts) · [Jito programs](https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/) · [Marinade program](https://github.com/marinade-finance/liquid-staking-program)
- [Coinbase staking lifecycle](https://docs.cdp.coinbase.com/prime/concepts/staking/staking-lifecycle) · [Marinade instant unstake](https://marinade.finance/blog/unlocking-liquidity-how-marinades-instant-unstake-solves-a-core-solana-native-staking-pain-point)

**Frontend and tooling**
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs) · [Lightweight Charts API](https://tradingview.github.io/lightweight-charts/docs/api)
- [Vite proxy](https://vite.dev/config/server-options.html#server-proxy) · [Vite static deploy](https://vite.dev/guide/static-deploy.html) · [Bun SQLite](https://bun.sh/docs/runtime/sqlite)
- [Phantom connection](https://docs.phantom.com/solana/establishing-a-connection) · [Privy frameworks](https://docs.privy.io/basics/troubleshooting/react-frameworks) · [Privy wallets](https://docs.privy.io/wallets/wallets/create/create-a-wallet)
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712) · [Cursor rules](https://cursor.com/docs/rules)

**Competitors and context**
- [Phantom Terminal](https://help.phantom.com/articles/trade-spot-and-perps-in-phantom-terminal-46527102843027) · [Prow Spot Hedge](https://prowdex.com/docs/bots/spot-hedge) · [DeFi Saver](https://defisaver.com/features/hyperliquid)
- [NullPoint](https://github.com/demigohu/nullpoint) · [Unhuntable](https://github.com/Jennycruzy/unhuntable) · [ZeroDelta](https://github.com/g4stein/zerodelta)
- [ADL paper (arXiv 2512.01112)](https://arxiv.org/abs/2512.01112)

**Hackathon**
- [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) · [Site, FAQ and judges](https://nearhackathon.com/) · [Apply](https://nearhackathon.com/#apply) · [Request changes](https://nearhackathon.com/request-changes) · [Project directory](https://nearhackathon.com/#projects)
- [DeFi example prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/01-defi.md)
