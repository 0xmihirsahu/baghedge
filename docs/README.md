# docs

The written contract, the design brief and the raw evidence for Baghedge. Start at [`../JUDGES.md`](../JUDGES.md) if you are judging; it links into this folder.

## Files

| File | What it is |
| --- | --- |
| [`API.md`](API.md) | The HTTP contract between the terminal and the backend: health, markets, accounts, hedge draft, arm, rule view, disarm and close, events, sign-in, funding and payout. Request and response shapes, error codes, UI labels. |
| [`INTEGRATION.md`](INTEGRATION.md) | Step by step wiring of [`../terminal/`](../terminal/) to the backend: the `/api` proxy, Privy wallet roles, sign-in, funding from any listed token, agent approval, arming, status, close, payout, manual orders, fees. Also what it takes to hedge more than SOL. |
| [`BAGHEDGE_CONTEXT.md`](BAGHEDGE_CONTEXT.md) | The full product, UX, engineering and security brief (sections 1 to 31). Its "What runs today" part is a Nov 14 snapshot; the README and JUDGES.md have the later mainnet results. Section 22 is the guard, section 18 the policy and scheduler. |
| [`evidence/mainnet.jsonl`](evidence/mainnet.jsonl) | One JSON line per mainnet step: fund through NEAR Intents, approve the guard agent, arm, guard-signed entry with recovery stop, wallet-drop buyback, Trade long, owner close, payout to Base, the multi-owner canary, and a full guarded cycle on the multi-owner guard (`multi-owner.guarded-cycle`). Tx hashes (Base, Hyperliquid, the OutLayer guard runs) and order ids. |
| [`evidence/testnet.jsonl`](evidence/testnet.jsonl) | The same for the testnet rehearsal: Trade place and cancel, open, agent approval, arm, a rule that expired without a crossing, a browser-agent order through the relay. Written by [`../scripts/live/testnet.ts`](../scripts/live/testnet.ts). |
| [`media/baghedge-mainnet-run.mp4`](media/baghedge-mainnet-run.mp4) | 64 s film of a full mainnet run done in the app: sign-in, fund, arm and disarm, a trade, payouts. |

## How it connects

- `API.md` describes the routes in [`../server/index.ts`](../server/index.ts) and [`../server/hedges.ts`](../server/hedges.ts).
- The policy fields in `API.md` and `BAGHEDGE_CONTEXT.md` section 18 are the ones in [`../shared/policy.ts`](../shared/policy.ts) and [`../guard/src/policy.rs`](../guard/src/policy.rs).
- [`../AGENTS.md`](../AGENTS.md) lists the engineering rules and maps them to sections of `BAGHEDGE_CONTEXT.md`.
- The evidence table in [`../README.md`](../README.md#whats-verified-live) is built from `evidence/mainnet.jsonl`.

## How to check

```sh
curl -s https://baghedge-api-mainnet.onrender.com/api/health   # compare with API.md "GET /api/health"
grep -o '"step": *"[^"]*"' docs/evidence/mainnet.jsonl         # the steps on record
```

Each evidence line carries public data only. Look up its hashes on Basescan, the NEAR Intents explorer, the Hyperliquid explorer or `https://api.outlayer.ai/attestations/by-tx/<tx>`.
