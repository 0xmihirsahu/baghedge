# Baghedge for judges

Baghedge is a Hyperliquid perps terminal that can hedge the SOL you already hold in your own wallet. The SOL never moves. A separate Hedge account opens a short when SOL falls through your entry, sizes it to what the wallet actually holds, and buys back when the wallet shrinks. An attested guard in an OutLayer TEE (NEAR) signs only what your signed policy allows. NEAR Intents moves money in and out from any of about 228 tokens.

Built at the NEAR Hackathon, track **Unstoppable DeFi** (`defi`).

| | |
|---|---|
| **Live app (mainnet)** | https://app.baghedge.xyz |
| **Site** | https://baghedge.xyz |
| **Film of a full mainnet run (64 s)** | [`docs/media/baghedge-mainnet-run.mp4`](docs/media/baghedge-mainnet-run.mp4) |
| **Backend health** | https://baghedge-api-mainnet.onrender.com/api/health |
| **API and integration** | [`docs/API.md`](docs/API.md) · [`docs/INTEGRATION.md`](docs/INTEGRATION.md) |
| **Evidence, raw** | [`docs/evidence/mainnet.jsonl`](docs/evidence/mainnet.jsonl) |

## Check it in five minutes

```sh
bun install && bun run check                    # typecheck + unit tests (server, worker, policy, guard client)
cargo +stable test --locked --manifest-path guard/Cargo.toml   # the Rust guard
curl -s https://baghedge-api-mainnet.onrender.com/api/health   # mode: mainnet, hedgeSigner.kind: guard, multiOwner: true
cd terminal && bun install && bun run build    # the terminal builds
```

Then open https://app.baghedge.xyz:
1. **Markets** → any of the 179 Hyperliquid perps, live from Hyperliquid. No sign-in needed.
2. **Hedge** (the SOL page) → drag the entry and recovery lines on the chart → the ticket shows margin and fees.
3. **Sign in** with email or Google (Privy) → you get two accounts, **Trade** and **Hedge**, shown in the sidebar.
4. **Portfolio → Add funds** → pick any token and chain → the quote shows what arrives and every fee before anything is signed.

## The full flow on mainnet, through the UI

Run on 2026-11-14 with a fresh Privy account (`test@vwakesahu.com`), every step clicked in the app by the test suite in [`terminal/e2e/`](terminal/e2e/) and recorded. The film above is the edit.

| Step | Evidence |
|---|---|
| Fund the Hedge account: 0.1 SOL → **6.66 USDC** through NEAR Intents | Solana [`fSMD9W3V…3ev`](https://solscan.io/tx/fSMD9W3Vue49oNJtGjQPyaS1bUc28yYS5tMrSoqZW2MtBDnnNkxwUA4NhkT7TFABsAGJDfVZYSt1vZme85QL3ev) → Intents [`HHo8ozFE…Jty5`](https://explorer.near-intents.org/transactions/HHo8ozFEh1asSd7TJ7JDMyUef6vAYKrrTraqeL9BJty5) `SUCCESS` → Hyperliquid [`0x57fe7401…22fb`](https://app.hyperliquid.xyz/explorer/tx/0x57fe7401a2bbc71e5046ace39c6461ba28fdeb0b0572c8f58c23f2d4c8ae22fb) |
| Look up this owner's own guard agent (multi-owner guard), approve it once, sign and arm a 0.15 SOL hedge | `ApproveAgent` on the Hedge account [`0xd878…788e`](https://app.hyperliquid.xyz/explorer/address/0xd8786Ba9E21Ee98d0C9bB438F14d8c6eFac2788e); rule `0xbbdc5dca…9530` armed |
| Disarm with an owner-signed command, status read back from the server | `POST /api/hedges/0xbbdc5dca…9530/disarm` |
| Pay the Hedge account back to SOL | Hyperliquid [`0xecac255f…0259`](https://app.hyperliquid.xyz/explorer/tx/0xecac255f81d3286eee250448cd976402030900451cd647409074d0b240d70259) → Intents [`0x8e6F6024…816f`](https://explorer.near-intents.org/transactions/0x8e6F60243F39B12C8f344e707cB85B3AFF49816f) → Solana [`4w8N7xui…vFU8`](https://solscan.io/tx/4w8N7xuidNPc65d2u438t8wbfaJqrAaG7Cn86SMvvb42PRj4VgMUpstQkBbGnphuHWFSKZJgom26PrAQDowwvFU8) |
| Fund the Trade account: 0.225 SOL → **15.35 USDC** | Solana [`5PAkh6na…MUVR`](https://solscan.io/tx/5PAkh6naQN1im7DT9nDCZ3couw1224Ridm7tiXqyUpAhM2ZrZw1iVk9H4CytA45yKXhNW9fokkJXAn9TCzLaMUVR) → Intents [`B8TteHsk…1xpQ`](https://explorer.near-intents.org/transactions/B8TteHskmrbwkGeusNR9h44DjaBzgu7w5Rt5PhjD1xpQ) → Hyperliquid [`0xb2658102…7af6`](https://app.hyperliquid.xyz/explorer/tx/0xb265810295bf36ca5e144caf1f9df073cf6d1f84fecdd47b1ea852ec839a7af6) |
| Trade: market Long 0.15 SOL, then Close, from a browser trading agent | Open @ 70.008 [`0x11575997…87cb`](https://app.hyperliquid.xyz/explorer/tx/0x11575997750eade112d10448cdafb4020c24007d1001ccb3b52004ea340287cb) · Close @ 69.776 [`0x9a62501e…370b`](https://app.hyperliquid.xyz/explorer/tx/0x9a62501ea72d5d209bdc0448cdb1850212c1000442207bf23e2afb716621370b) |
| Pay the Trade account back to SOL: 13.9 USDC → 0.198 SOL | Hyperliquid [`0x0f35828a…7d6c`](https://app.hyperliquid.xyz/explorer/tx/0x0f35828ac322a38210af0448cdb45e02088400705e25c254b2fe2ddd82267d6c) → Intents [`0x48CF8BD2…6DaF`](https://explorer.near-intents.org/transactions/0x48CF8BD2F4dE8131B11eaf9437c7CE5eEBA16DaF) → Solana [`4bHEiwHa…uNGL`](https://solscan.io/tx/4bHEiwHaAex6rTX38KA86HqhXsc4KcMgUVheopsCLT8GzP5FES6SNakMBUNjrzmN3RxwvRMscKYvbX1CVH1RuNGL) |

The guard-signed hedge entry, its recovery stop, the reduce-only buyback when SOL left the wallet, and the owner close all ran on mainnet earlier, with OutLayer attestations. They're in the [README's evidence table](README.md#whats-verified-live).

Cost of the whole UI run: about $5, mostly fixed fees (1 USDC to activate each new Hyperliquid account, 1 USDC per payout).

## The five criteria

| Criterion | Where to look |
|---|---|
| **Technical implementation** | A Rust guard in an OutLayer TEE ([`guard/`](guard/)) holds the hedge key and signs only inside the owner's EIP-712 policy; each owner gets their own derived agent. A worker ([`server/worker.ts`](server/worker.ts)) watches the mark and the wallet, sizes from confirmed fills, and only reduces on buyback. Funding and payout from any of ~228 tokens through NEAR Intents 1Click ([`server/intents.ts`](server/intents.ts)). The terminal signs every owner action in the browser with Privy embedded wallets ([`terminal/components/app/live.ts`](terminal/components/app/live.ts), [`privy.tsx`](terminal/components/app/privy.tsx)); manual orders go straight to Hyperliquid from a browser trading agent that can't withdraw ([`trade.ts`](terminal/components/app/trade.ts)). |
| **Design** | One sign-in brings both accounts. The hedge is drawn on the chart and the ticket shows margin, fees and the $10 venue minimum before anything is signed. Funding shows each state (waiting, detected, in transit, credited) with links to Solana, NEAR Intents and Hyperliquid. Every result toasts a link to the explorer. See the film. |
| **Impact** | Holders today either sell, or keep the coin and wear the drawdown. Baghedge hedges the coin where it already sits: nothing to deposit, nothing to bridge out of cold storage. A hedge runs only while armed and follows the wallet. |
| **Originality** | Of 1,404 NEAR hackathon entries scanned on 2026-11-14, none hedges a coin in the user's own wallet. Vaults hedge coins you deposit; stop-hiders protect trades. Baghedge reads the wallet and sizes the short to it. |
| **Sustainability** | Live on mainnet and kept up through judging. A per-owner guard serves any number of users. Hyperliquid builder codes can carry a small disclosed fee for guard gas and hosting. Disclosed risk: the guard's NEAR execution key was shared during development; a holder could request extra orders within a user's signed limits, never a withdrawal (`/api/health` → `disclosures`, shown in the app's hedge review). |

## Map of the repo

| Path | What it is |
|---|---|
| [`terminal/`](terminal/) | The app at app.baghedge.xyz. Next.js 16, Privy, wagmi, Solana wallet adapter, Lightweight Charts. |
| [`terminal/e2e/`](terminal/e2e/) | The test suite that drove the mainnet run: real Chrome, rails that block money calls unless allowed, a recording of every flow, a stuck detector. |
| [`server/`](server/) | The API and hedge worker (Bun): policies, sessions, the relay for owner-signed Hyperliquid actions, NEAR Intents quotes. |
| [`guard/`](guard/) | The Rust guard that runs in OutLayer and signs hedge orders. |
| [`shared/`](shared/) | The EIP-712 policy, amounts and types shared by the server and the browser. |
| [`landing/web/`](landing/web/) | baghedge.xyz. |
| [`docs/`](docs/) | API, integration guide, design context and the raw evidence. |
