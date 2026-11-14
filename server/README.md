# server

The Baghedge backend. One Bun process serves the `/api` routes the terminal calls and runs the hedge worker. It never holds an owner key: owners sign in the browser, and the server checks each signature before it relays anything.

Live: mainnet https://baghedge-api-mainnet.onrender.com/api/health (attested guard), testnet sandbox https://baghedge-api.onrender.com/api/health.

## Files

| File | What it does |
| --- | --- |
| [`index.ts`](index.ts) | Entry point. Reads env, picks the hedge signer (`guard`, multi-owner `guard`, or labeled `fallback`), wires every route, starts the worker, binds the port (3001). Also the per-owner guard agent cache. |
| [`worker.ts`](worker.ts) | The hedge loop. Every 4 s, per Hedge account and one at a time: reconcile journaled orders by cloid, confirm the recovery stop, decide entry, resize or close, then reserve, sign, send and reconcile again. |
| [`hedges.ts`](hedges.ts) | `/api/hedges` routes: agent lookup, draft a policy, arm a signed policy, rule views, owner-signed disarm and close. Computes the required margin. |
| [`guard.ts`](guard.ts) | Adapter to the Rust guard on OutLayer. Builds `request_execution` args, runs it from the NEAR executor account, checks the result matches the request. Single-owner and multi-owner. |
| [`exchange.ts`](exchange.ts) | Hyperliquid writes: canonical action order, signing, submit, order status, and `verifiedSigner`, which recovers the signer before any send. |
| [`db.ts`](db.ts) | SQLite journal: rules, actions (cloid, nonce, transport, outcome), fills, nonces, events. Rows are written before a send. |
| [`owner.ts`](owner.ts) | Owner-signed `approveAgent` and `sendAsset`. Builds the EIP-712 payload, checks the recovered signer, relays the exact action. |
| [`intents.ts`](intents.ts) | NEAR Intents 1Click quotes, asset list and status for funding and payout. |
| [`transfers.ts`](transfers.ts) | SQLite store for saved funding and payout quotes. |
| [`session.ts`](session.ts) | Wallet sign-in (EIP-191 challenge bound to origin, env, address, nonce) and the `HttpOnly` session cookie. |
| [`venue.ts`](venue.ts) | Read-only Hyperliquid views (markets, account balances) and the Solana SOL balance read. |
| [`hlinfo.ts`](hlinfo.ts) | Shared Hyperliquid `/info` client with short caching for UI reads and no caching for worker reads. |
| [`hlstream.ts`](hlstream.ts) | Websocket mark price and top of book; returns nothing when stale so callers fall back to HTTP. |
| [`preview.ts`](preview.ts) | `POST /api/hedges/preview`: sizes a hedge against the wallet's liquid SOL before anything is signed. |
| [`http.ts`](http.ts) | `RequestError`, provider fetch with timeout, small input checks. |
| [`ops/`](ops/) | Localhost-only owner console at `/ops` (with `OPS_PAGE=1`): connect a wallet, approve the agent, sign a policy, close, pay out. Not the product UI. |

## How it connects

- Pure logic it uses lives in [`../shared/`](../shared/): the EIP-712 policy, the hedge state machine, order building, amounts.
- Hedge orders are signed by the guard in [`../guard/`](../guard/) through `guard.ts`. The server refuses a policy whose `guardBuildHash` or `guardAgent` differs from what it runs.
- The terminal in [`../terminal/`](../terminal/) proxies `/api/*` here. The contract is [`../docs/API.md`](../docs/API.md); the wiring guide is [`../docs/INTEGRATION.md`](../docs/INTEGRATION.md).
- Deployed from [`../Dockerfile`](../Dockerfile) and [`../render.yaml`](../render.yaml) as a single instance, because the worker is the only writer per Hedge account.

## Run and test

From the repo root:

```sh
bun install
bun run check                      # tsc + bun test (unit tests in ../test/)
cp .env.example .env.testnet       # fill in; every key is commented
bun run start:testnet              # API + worker on :3001
bun run dev:server                 # same entry point with --watch (no --env-file)
curl -s localhost:3001/api/health
bun run smoke:api https://baghedge-api.onrender.com   # needs .env.testwallets
```

`HEDGE_SIGNER` empty means reads and quotes only, no hedging. `WORKER=0` turns the worker off.
