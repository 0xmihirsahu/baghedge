# test

Unit tests for the backend and the shared logic, run with `bun test`. They use in-memory SQLite, stubbed `fetch`, fake websockets and a fake venue, so they need no network, no keys and no `.env` file. The Rust guard has its own tests in [`../guard/`](../guard/).

## Files

| File | What it checks |
| --- | --- |
| [`worker.test.ts`](worker.test.ts) | [`../server/worker.ts`](../server/worker.ts) against an in-memory venue: the full cross, entry with confirmed stop, wallet-drop resize, recovery close; an unknown send is reconciled, never re-sent; partial entry installs a position stop; guard errors and refusals pause the rule. 23 tests. |
| [`hedges.test.ts`](hedges.test.ts) | [`../server/hedges.ts`](../server/hedges.ts): a signed policy arms once, a policy naming another signer is refused, rule reads need the owner's session, the required margin example, unified-account margin, per-owner guard agents and their cache. |
| [`hedge.test.ts`](hedge.test.ts) | [`../shared/hedge.ts`](../shared/hedge.ts) and [`../shared/orders.ts`](../shared/orders.ts): retries only after a confirmed zero fill, partial entry ends opening, stale wallet reads stop entry and resize, the bounded IOC plus reduce-only recovery order. |
| [`policy.test.ts`](policy.test.ts) | [`../shared/policy.ts`](../shared/policy.ts): the EIP-712 type string matches the guard's, only the Hedge owner's signature passes, aliased accounts and inverted bands are refused, cloids are deterministic, rounding stays inside the signed bounds. |
| [`exchange.test.ts`](exchange.test.ts) | [`../server/exchange.ts`](../server/exchange.ts): signer recovery over a known vector, `verifiedSigner` refuses a wrong key, canonical field order before hashing, venue response parsing. |
| [`guard.test.ts`](guard.test.ts) | [`../server/guard.ts`](../server/guard.ts): a guard refusal versus an unknown outcome, per-owner agent binding, fails closed on a mismatched agent or equal Trade and Hedge. |
| [`owner.test.ts`](owner.test.ts) | [`../server/owner.ts`](../server/owner.ts): `approveAgent` and `sendAsset` typed data sign the same as the official SDK; the relay refuses a wrong signer, network or destination. |
| [`api.test.ts`](api.test.ts) | [`../server/index.ts`](../server/index.ts) routes: funding and payout quotes in source units, testnet refuses executable funding and aliased accounts, hedge preview sizing. |
| [`hlinfo.test.ts`](hlinfo.test.ts) | [`../server/hlinfo.ts`](../server/hlinfo.ts) caching and 429 handling, [`../server/hlstream.ts`](../server/hlstream.ts) freshness, and mark crossing from the stream. |
| [`request-log.test.ts`](request-log.test.ts) | The request log in `index.ts` never writes query strings or cookies. |

## How it connects

These tests cover [`../server/`](../server/) and [`../shared/`](../shared/). The rules they enforce come from [`../AGENTS.md`](../AGENTS.md) (journal before writing, reconcile before retrying, Trade not equal to Hedge, no floats for money). The guard's SDK vectors live in [`../fixtures/`](../fixtures/).

## Run

From the repo root:

```sh
bun install
bun run check                    # tsc --noEmit, then bun test: 68 tests in 10 files
bun test test/worker.test.ts     # one file
```

`worker tick failed for r1: OutLayer 503` in the output is an expected log from a test that simulates a guard outage.
