# fixtures

Golden test vectors that tie the Rust guard to the official Hyperliquid TypeScript SDK and to the TypeScript policy code. Public test data only. Never submit any of it to a venue.

## Files

| File | What it is |
| --- | --- |
| [`vectors/hl-actions.json`](vectors/hl-actions.json) | Made with `@nktkas/hyperliquid@0.33.3` and `viem@2.57.19` (see its `source` field). Holds a signed mainnet `policy` (policy, owner signature, EIP-712 digest, chain id, entry deadline), a testnet `peerPolicy` with its digest, `cancelRefs`, and seven Hyperliquid actions. |

The seven `vectors`: IOC without expiry, IOC with expiry, entry with recovery stop, cancel by cloid, resize, close, position stop. Each has the action, nonce, optional `expiresAfter`, `source` (`a` mainnet, `b` testnet), the expected L1 action hash (`connectionId`) and the expected agent digest. The entry, resize, close and position stop vectors also carry the `orderRef` (intent and sequence) their cloids come from.

## How it connects

- Only [`../guard/src/main.rs`](../guard/src/main.rs) reads this file, with `include_str!`, in its unit tests:
  - `venue_hashes_and_agent_digests_match_sdk`: the Rust msgpack hash and agent digest equal the SDK's for every vector.
  - `policy_requires_the_pinned_owner_and_exact_signed_fields`: the Rust policy digest equals the one viem signed, and a changed field or owner fails.
  - `testnet_policy_digest_matches_workers_vector`: the testnet digest from the TypeScript side matches.
  - the cloid and bounds tests use the policy, vectors and `cancelRefs` to check that each order leg is tied to its rule, intent and sequence.
- On the TypeScript side, [`../test/exchange.test.ts`](../test/exchange.test.ts) expects the same "IOC with expiry" hash, and [`../test/policy.test.ts`](../test/policy.test.ts) checks the policy type string against the Rust one.
- The rule in [`../AGENTS.md`](../AGENTS.md) (16): when venue signing changes, add vectors with and without `expiresAfter`.

## Run

```sh
cargo +stable test --locked --manifest-path guard/Cargo.toml
```

If you change [`../shared/policy.ts`](../shared/policy.ts), [`../shared/orders.ts`](../shared/orders.ts) or the guard's hashing, regenerate the vectors from the SDK and expect these tests to fail until both sides agree.
