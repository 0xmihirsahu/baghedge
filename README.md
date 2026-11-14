# Baghedge backend

The Baghedge backend: live market, account and liquid SOL reads; Base ↔ Hyperliquid perps USDC quotes and status through NEAR Intents 1Click; owner sign-in; and the Wallet Hedge worker, which journals, signs, submits and reconciles hedge orders. The browser API contract is in [docs/API.md](docs/API.md).

**Status (Nov 14):**

| Area | State |
| --- | --- |
| Hedge worker, journal, hedge API | Implemented and unit-tested |
| Venue orders on testnet | Verified with the labeled fallback signer: Trade place/cancel/fill and hedge-agent approval ([evidence](docs/evidence/testnet.jsonl)). The hedge entry, recovery stop and resize are in progress. |
| OutLayer guard | Order-signing guard and adapter implemented. A public-key probe run is independently attested on NEAR mainnet. The pinned trading build, its agent approval and a guard-signed fill still need live proof. |
| Mainnet funding, payout, guard-signed hedge | Not yet run |

`bun run demo:replay` uses sample fills, not live data.

## Run it

```sh
bun install --frozen-lockfile
bun run dev:server
bun run check
bun run demo:replay
bun run verify:quotes
```

The server listens on `127.0.0.1:3001` by default and uses Hyperliquid testnet with Solana devnet. Use relative `/api` calls through the frontend's dev proxy, or set `APP_ORIGIN` to the frontend's origin for local development. See `.env.example`. Keep this API on localhost while wallet sessions and public API controls are being added.

## Call it from the terminal

| Endpoint | Result |
| --- | --- |
| `GET /api/health` | Venue mode and executable quote availability. |
| `GET /api/markets` | Default Hyperliquid perp markets, asset IDs, size precision, mark prices, and funding rates. |
| `GET /api/accounts?trade=<evm>&hedge=<evm>` | Trade and optional Hedge snapshots with orders and positions. The addresses must differ. |
| `GET /api/wallet/sol?address=<solana>` | Liquid SOL in lamports, with the observed slot and commitment. |
| `POST /api/hedges/preview` | Current SOL hedge size against a liquid wallet balance and separate flat Hedge account. |
| `POST /api/transfers/quote` | Exact input quote and, for an executable quote, an unsigned transfer description. |
| `GET /api/transfers/<id>` | Persisted executable quote and current NEAR Intents status. |

Pass `tradeAddress`, `hedgeAddress`, `solanaAddress`, `maxSol`, `entryMark`, `entryFloor`, `recoveryMark`, and `exitCeiling` to the hedge preview. Prices and size are decimal strings. The preview sizes against liquid SOL and checks the price band and the account's current positions and orders. A preview is informational and creates no hedge rule.

For a quote, pass `direction` (`fund` or `withdraw`), `role` (`trade` or `hedge`), `baseAddress`, `venueAddress`, and the USDC `amount` as a decimal string. Dry quotes are available in either API mode and always show mainnet route data. Set `dry: false` with `APP_MODE=mainnet` to obtain an executable deposit address for the requested route.

Review the returned recipient, refund address, amounts, and `deadline` before signing. Use the returned `transfer` fields to construct the owner-signed Base ERC-20 transfer or HyperCore `sendAsset`. The API provides intent status separately from independent checks of venue credit or recipient settlement. `depositDeadline` is the provider's deposit deadline, while `deadline` is the shorter review deadline for initiating the transfer. Amounts ending in `In` or `Out` are integer strings with the corresponding returned decimal precision.

## OutLayer guard

```sh
rustup target add --toolchain stable wasm32-wasip2
cargo +stable test --locked --manifest-path guard/Cargo.toml
cargo +stable build --locked --manifest-path guard/Cargo.toml --target wasm32-wasip2 --release
```

The guard declares a build-bound secp256k1 key for a direct OutLayer WASM run. It returns the derived public key, or signs a Hyperliquid order or cancel that it rebuilds from validated fields under the owner's signed policy (`sign_order`). It never signs raw bytes. The worker calls it through `server/guard.ts` and checks the recovered signer before submitting. The public-key probe build has an independently verified attestation. Only the final pinned build's own attested agent may be approved for live hedging. [OutLayer signing keys](https://app.outlayer.ai/docs/signing-keys) · [Direct WASM execution](https://app.outlayer.ai/docs/near-integration)

[Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) · [NEAR Intents Hyperliquid route](https://docs.near-intents.org/integration/distribution-channels/1click-api/hyperliquid)
