# guard

The Rust signer for the Hedge account. It runs as a `wasm32-wasip2` component inside an OutLayer TEE (Intel TDX, on NEAR) and signs a Hyperliquid order only when it fits the owner's signed `HedgePolicy`. It never signs raw bytes, transfers, withdrawals or agent approvals.

## Files

| File | What it does |
| --- | --- |
| [`src/main.rs`](src/main.rs) | Reads one JSON request from stdin (max 8 KB), writes one JSON result to stdout. Operations: `public_key`, `sign_order`, and `sign_challenge` (single-owner only, prefixed digest). Also the unit tests. |
| [`src/policy.rs`](src/policy.rs) | The EIP-712 `HedgePolicy` type and digest, owner signature recovery, and the checks: right owner, Trade not equal to Hedge, market `SOL`, pinned asset id, sane price bands, `guardAgent` match. |
| [`src/orders.rs`](src/orders.rs) | Typed `order` and `cancelByCloid` actions with `deny_unknown_fields`. Checks size, prices inside the signed bounds, reduce-only buys, the recovery stop, and that every cloid is derived from the rule, intent and sequence. |
| [`src/crypto.rs`](src/crypto.rs) | keccak, EIP-712 words, secp256k1 recovery, and the Hyperliquid L1 action hash (msgpack + nonce + `expiresAfter`) and agent digest. |
| [`src/owner_agent.rs`](src/owner_agent.rs) | `multi-owner` feature only. Derives a separate agent key per Hedge owner and network inside the enclave, and accepts only the compiled NEAR caller. |
| [`manifest.json`](manifest.json) | Single-owner build: one `secp256k1` signing key, `bind: "wasm"`. |
| [`manifest.multi-owner.json`](manifest.multi-owner.json) | Multi-owner build: an encryption key, `bind: "wasm"`, `caller: "predecessor"`. |
| [`wit/`](wit/), [`wit-multi-owner/`](wit-multi-owner/) | OutLayer host interfaces for each build. |
| [`MULTI_OWNER.md`](MULTI_OWNER.md) | The multi-owner build recipe and the checks to run before switching a backend to it. |

## Attestation and the build hash

- The key is bound to the WASM (`bind: "wasm"`). Different bytes give a different agent key, so an owner's agent approval only works for the build that derived that agent.
- OutLayer runs the WASM from a URL and checks it against a SHA-256 given in the request. That SHA-256 is the build hash. Each run gets a TDX attestation at `https://api.outlayer.ai/attestations/by-tx/<tx>`.
- The owner signs `guardAgent` and `guardBuildHash` into the policy. The server ([`../server/guard.ts`](../server/guard.ts)) refuses a policy for another build or agent, and the guard re-derives its agent and refuses if it differs from `guardAgent`.
- The guard is stateless. Cumulative size and data freshness are worker checks in [`../server/worker.ts`](../server/worker.ts).
- The live build hash is in `GET https://baghedge-api-mainnet.onrender.com/api/health` under `hedgeSigner.buildHash`. To compare, build with the recipe in [`MULTI_OWNER.md`](MULTI_OWNER.md) and run `shasum -a 256` on the `.wasm`. Same bytes need the same source, toolchain and build variables.

## How it connects

- [`../shared/policy.ts`](../shared/policy.ts) mirrors `POLICY_TYPE` and the domain. [`../test/policy.test.ts`](../test/policy.test.ts) compares the TypeScript type string to the Rust one, and a Rust test checks the policy digest against a TypeScript-made vector.
- The Rust tests read [`../fixtures/vectors/hl-actions.json`](../fixtures/vectors/hl-actions.json), vectors made with the official TypeScript SDK, so Rust and TypeScript hash the same bytes.
- [`../scripts/live/outlayer.ts`](../scripts/live/outlayer.ts) uploads a built `.wasm` to FastFS and runs a `public_key` lookup.

## Run and test

From the repo root:

```sh
cargo +stable test --locked --manifest-path guard/Cargo.toml                          # 6 tests
cargo +stable test --locked --manifest-path guard/Cargo.toml --features multi-owner   # 9 tests
```

Tests need no network and no build variables. A deployable build needs `rustup target add wasm32-wasip2` and the `BAGHEDGE_*` variables read at compile time (pinned owner or caller, network, asset id, size decimals); see [`MULTI_OWNER.md`](MULTI_OWNER.md).
