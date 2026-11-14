# terminal

The baghedge app: a Hyperliquid perps terminal with a wallet hedge. Live on mainnet at **https://app.baghedge.xyz**, and a testnet copy for testing.

Next.js 16 (App Router, Cache Components), React 19, Tailwind 4, Privy, wagmi, the Solana wallet adapter, Lightweight Charts, `@nktkas/hyperliquid`.

## What you can do in it

| Page | What it does |
|---|---|
| `/` (Hedge, the SOL page) | The SOL chart with draggable entry and recovery lines, the live tape, positions, and the ticket. **Hedge** drafts a policy and shows margin, fees and the $10 venue minimum. **Review hedge** opens the review card, then **Sign and arm**. **Trade** places real market orders. |
| `/markets` | All 179 Hyperliquid perps, live: search, gainers and losers, sort by volume, open interest or funding. |
| `/markets/[coin]` | Any perp: chart, tape, your positions with **Close**, and the trade ticket. |
| `/portfolio` | The watched SOL wallet, the live hedge, and both Hyperliquid accounts with **Add funds** and **Pay out**. |
| `/activity` | Fills from both accounts, each linked to its transaction on the Hyperliquid explorer. |

## How a user goes through it

1. **Sign in** with email or Google (Privy). Two embedded EVM wallets are made: the first is the **Trade** account, the second the **Hedge** account. They're always different addresses.
2. **Add the SOL to hedge**: connect Phantom (or any Solana wallet) or paste an address. It's read only; nothing is signed with it except a funding transfer the user starts.
3. **Add funds** to either account from any of ~228 tokens on 38 chains through NEAR Intents. The sheet shows what arrives and every fee first, then tracks it: waiting, detected, in transit, credited, with Solana, NEAR Intents and Hyperliquid links.
4. **Review hedge**: the app signs in to the backend, looks up this owner's own guard agent (10–30 s the first time), and drafts the policy. **Sign and arm** approves that agent once (Hyperliquid accepts it only on a funded account) and signs the policy. From then on the backend worker and the attested guard run it.
5. **Trade**: Long or Short at the chosen leverage. The first order approves a browser trading agent that can trade but never withdraw.
6. **Disarm or close** with an owner-signed command, **Pay out** back to any token and address.

Every owner signature happens in the browser. The backend holds no owner keys.

## Code map

| Path | What it is |
|---|---|
| `app/(terminal)/` | The pages above, inside one shell (`components/shell.tsx`). |
| `app/api/balance/route.ts` | Server-only SOL balance reads (Alchemy, then public RPCs). The Alchemy key never reaches the browser. |
| `proxy.ts` | Same-origin proxy for `/api/*` to the backend: drops the page's own `Origin` (the backend accepts one origin) and refuses other sites. |
| `components/app/store.tsx` | Shared state: network from `/api/health`, markets, wallets, accounts, the live hedge, trading and the funds sheet. |
| `components/app/privy.tsx` | Privy sign-in, the Trade and Hedge embedded wallets, and silent signing. |
| `components/app/live.ts` | The live hedge: backend sign-in, per-owner agent lookup and approval, draft, arm, live status (server-sent events plus a poll), disarm and close. |
| `components/app/trade.ts` | Manual orders: the browser trading agent, market IOC orders, reduce-only closes. |
| `components/app/funds.ts` · `components/funds.tsx` | Add funds and Pay out through NEAR Intents, for Solana, EVM and hand-sent deposits. |
| `components/app/hl.ts` | Hyperliquid reads with host fallback: markets, candles, trades, accounts (unified accounts included), explorer links. |
| `components/ticket.tsx` · `coin.tsx` · `chart.tsx` | The ticket, the coin page with the review card, and the chart. |
| `e2e/` | The browser test suite that ran the full mainnet flow: [`e2e/README.md`](e2e/README.md). |

## Run it

```sh
cd terminal
cp .env.example .env      # BAGHEDGE_API_URL, NEXT_PUBLIC_NETWORK, NEXT_PUBLIC_PRIVY_APP_ID, ALCHEMY_API_KEY (optional)
bun install
bun run dev               # http://localhost:3000
bun run build             # production build
```

- **Mainnet:** `BAGHEDGE_API_URL=https://baghedge-api-mainnet.onrender.com`, `NEXT_PUBLIC_NETWORK=mainnet`.
- **Testnet:** `BAGHEDGE_API_URL=https://baghedge-api.onrender.com`, `NEXT_PUBLIC_NETWORK=testnet`. Funding runs on mainnet only (NEAR Intents has no testnet); on testnet the sheet links Hyperliquid's faucet.
- **Without a Privy App ID** the app still runs: an external EVM wallet can stand in for the Trade and Hedge accounts.
- **Without the backend** the hedge runs as a labelled replay, and markets and accounts still read from Hyperliquid.

## Deployed

| | URL | Backend |
|---|---|---|
| Production | https://app.baghedge.xyz | mainnet, attested guard |
| Testnet | https://testnet.baghedge.xyz | testnet sandbox, demo signer |

Both are Vercel projects built from this folder.
