# scripts

Small Bun scripts to replay the hedge logic, check live quotes, and drive real runs against a backend. Run them from the repo root, because some read `.env.*` files by relative path.

## Files

| File | What it does |
| --- | --- |
| [`replay.ts`](replay.ts) | Runs [`../shared/hedge.ts`](../shared/hedge.ts) on sample prices and fills: manual long, hedge entry, SOL leaving the wallet, buyback, closes. Prints net SOL exposure after each step. No network, no keys. |
| [`verify-quotes.ts`](verify-quotes.ts) | Asks NEAR Intents 1Click for dry quotes in both directions (25 Base USDC to Hyperliquid USDC and back) through [`../server/intents.ts`](../server/intents.ts). No signing. |
| [`live/api-smoke.ts`](live/api-smoke.ts) | End to end HTTP check of a running backend, the way a frontend calls it: markets, accounts, wallet reads, policy draft, owner signature and arm, refusals, sign-in sessions, events, owner-signed disarm. Needs `.env.testwallets` (test keys). Never moves funds. |
| [`live/testnet.ts`](live/testnet.ts) | Testnet rehearsal driver with subcommands (`status`, `trade-limit-cancel`, `trade-open`, `approve-agent`, `arm`, `rule`, `move-sol`, `close-rule`, and more). Signs with test keys and appends public results to [`../docs/evidence/testnet.jsonl`](../docs/evidence/testnet.jsonl). |
| [`live/outlayer.ts`](live/outlayer.ts) | Publishes a built guard `.wasm` to FastFS (`upload`) and runs a `public_key` lookup on OutLayer (`public-key`). Signs with the NEAR executor key from env; prints only public data. |
| [`live/ops-proxy.ts`](live/ops-proxy.ts) | Serves the `/ops` owner console on `127.0.0.1:3003` and forwards `/api/*` to `BAGHEDGE_API_URL` (default: the mainnet backend). No worker or database runs here. |

## How it connects

- `replay.ts` and `verify-quotes.ts` reuse [`../shared/`](../shared/) and [`../server/intents.ts`](../server/intents.ts) directly.
- The `live/` scripts talk to the backend in [`../server/`](../server/) over HTTP, or to OutLayer for the guard in [`../guard/`](../guard/).

## Run

```sh
bun install
bun run demo:replay                                      # replay.ts
bun run verify:quotes                                    # verify-quotes.ts, needs network
bun run smoke:api https://baghedge-api.onrender.com      # api-smoke.ts, needs .env.testwallets
bun scripts/live/testnet.ts status                       # needs a local testnet backend and .env.testwallets
bun scripts/live/ops-proxy.ts                            # then open http://127.0.0.1:3003/ops
```

`outlayer.ts` needs `OUTLAYER_CALLER` and `OUTLAYER_NEAR_PRIVATE_KEY`; see its header for usage. `.env.testwallets` and `.env.local` are gitignored and not in the repo.
