# Multi-owner guard candidate

This is an opt-in SOL guard. The default build and deployed single-owner guard use the existing signing-key interface. Keep the multi-owner backend flag off until the checks below pass.

The feature uses OutLayer's [encryption-key host](https://app.outlayer.ai/docs/encryption-keys) to derive separate Hyperliquid agent keys for the Hedge owners. The host key is bound to the exact WASM and the immediate NEAR caller. The component accepts only direct transactions from its compiled caller. It derives a child key inside the enclave over a fixed Baghedge domain, the venue network and the 20-byte owner address. It never returns that key or its derivation bytes. Public discovery returns the owner, agent address and agent public key. An order must first pass owner signature and action checks; the policy's `guardAgent` must match the derived key before the component signs. The server checks the configured build hash; the component does not independently read its own hash.

For the candidate, get the market asset ID and size precision from Hyperliquid metadata for the intended network, and use a dedicated NEAR caller. A build with the example caller is local verification only; do not publish or fund it.

```sh
export BAGHEDGE_MULTI_OWNER_CALLER='<NEAR executor account>'
export BAGHEDGE_PINNED_NETWORK='<mainnet or testnet>'
export BAGHEDGE_PINNED_ASSET_ID='<SOL asset ID from this network>'
export BAGHEDGE_PINNED_SIZE_DECIMALS='<SOL lot precision from this network>'
rustup target add wasm32-wasip2 --toolchain 1.97.1
cargo +1.97.1 test --locked --manifest-path guard/Cargo.toml --features multi-owner
cargo +1.97.1 build --locked --manifest-path guard/Cargo.toml --features multi-owner --target wasm32-wasip2 --release
shasum -a 256 guard/target/wasm32-wasip2/release/baghedge-guard-probe.wasm
```

For deployment, record the toolchain, platform, feature, source commit, exact artifact and SHA-256 together. The upstream OutLayer build script's default `cargo build` does not enable this feature or forward its build variables. Build twice with the same recipe and compare bytes. A new hash or caller generates new agents; settle existing rules and get new owner approvals before switching.

Before turning on `OUTLAYER_MULTI_OWNER=1` on a separate canary backend, verify the exact deployed bytes and TEE attestations for two `public_key` runs with distinct owner addresses from the compiled caller. Each returned address must match its public key and the two agents must differ. Verify both approvals, a cross-owner `sign_order` refusal with no signature, and a real entry and exit for an approved owner. The agent lookup's transaction hash is a reference to the OutLayer execution, not a completed DCAP verification. Cap paid discovery globally before exposing it to arbitrary account sessions. Keep the single-owner backend and its executor unchanged throughout the canary.

The guard checks each action in isolation. The worker still owns wallet and mark freshness, active rule state, total entry sizing across requests, and journal reconciliation. A compromised caller could request repeated actions under a valid policy within those per-action restrictions, or drain the NEAR account and stop the service. A build pinned to the previously exposed demo executor is for controlled verification only; public use needs an independent authorization boundary for order signing.
