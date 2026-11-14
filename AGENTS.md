# AGENTS.md: Baghedge

The [Baghedge brief](docs/BAGHEDGE_CONTEXT.md) is the source of truth for the product and design. The [README](README.md) lists what runs today. Section numbers below refer to the brief.

## What this is

- A Hyperliquid trading terminal with a wallet-aware SOL hedge (**Wallet Hedge** mode), built for the NEAR Hackathon.
- **Two accounts.** The **Trade** account (manual orders) and the **Hedge** account (the hedge short) are two distinct Hyperliquid master accounts.
- **The worker (`server/`) runs the hedge.** Implemented and unit-tested. Testnet venue evidence is in `docs/evidence/testnet.jsonl`.
  - It enters on a mark crossing: a bounded IOC sell with a reduce-only recovery stop attached (`normalTpsl`).
  - It reduces the hedge when the watched SOL drops.
  - It closes on recovery, at expiry, or when the owner asks.
- **The guard** runs on OutLayer as a named Hyperliquid agent with an expiry. `guard/` implements policy-checked `sign_order` for `wasm32-wasip2`, and `server/guard.ts` is the worker adapter. Only a public-key probe run is attested so far. Approve only the final pinned build's attested agent.
- **Funding** uses NEAR Intents 1Click for Base USDC ↔ HyperCore perps USDC. The API returns quotes, unsigned transfer details, and route status.

## Layout and commands

- One Bun package. `server/` serves the local API, `shared/` holds browser-safe logic, `guard/` holds the Rust guard, and `scripts/` holds replay and quote checks.
- Run `bun install --frozen-lockfile`, then use `bun run dev:server`, `bun run check`, `bun run demo:replay`, or `bun run verify:quotes`. See the README for the local guard build.
- The frontend teammate owns the terminal UI. Keep backend changes independent of the Vite app unless the team asks for integration work.

## Hard rules

1. **No floats for money or sizes.**
   - Use bigint lamports, bigint market lots (1 lot = 10^-szDecimals) and bigint token base units.
   - Use fixed-point integers or an exact decimal library for price math.
   - Use decimal strings at JSON boundaries. Convert to `number` only for charts and display. (Section 15)
2. **Read market constants at runtime.** Get the asset ID, `szDecimals` and `maxLeverage` from `meta`. Never hardcode SOL's index (observed 5) or decimals (observed 2). (Section 19)
3. **Precision.**
   - Round sizes down to `szDecimals`.
   - Non-integer perp prices: at most 5 significant figures and at most `6 − szDecimals` decimals. Integer prices are always allowed.
   - Round toward safety: a sell floor rounds up, a buy ceiling rounds down.
4. **Journal before writing.** Persist an action ID and the data needed to reconcile. For orders, include each leg's cloid and the venue nonce. For transfers, keep the reviewed route and record the source receipt once available.
5. **Reconcile before retrying.**
   - An unknown result stays pending until `orderStatus`, fills and positions rule it out.
   - An HTTP 200 can carry per-order errors, and IOC fills can be partial.
6. **One writer per `(env, hedgeAddress)`.** Prefer one IOC in flight.
7. **Query Hyperliquid info with the master address,** never the agent's address.
8. **Trade ≠ Hedge.** Reject equal accounts in the UI, the adapter and the signing path.
9. **Entry retries** only after a confirmed zero fill, inside the signed band and window. A new attempt gets new cloids and a new nonce. A partial fill ends opening. Never top it up.
10. **Recovery stop status.**
    - Show **Recovery stop active** only after the venue confirms it.
    - After a partial fill, install a position stop. Until it's confirmed, show **Recovery stop missing** or **Checking recovery stop**.
11. **Never** use `scheduleCancel` for expiry. **Never** build a resting venue entry; that's experiment only.
12. **Guard rules.** Build venue actions from validated fields. Never add a raw digest or bytes signing operation. Bind each agent to the approved Hedge owner through trusted configuration or a verified venue association. Refuse the wrong account or market, buys that aren't reduce-only, prices outside the signed bounds, and all transfers. Describe cumulative caps, active policy state, and observation freshness as worker checks until the guard can verify them independently (section 22).
13. **Secrets never go in the browser bundle or the logs:** RPC keys, `INTENTS_JWT`, the OutLayer payment key, any private key.
14. **Environments.** The server accepts `APP_MODE=testnet` or `APP_MODE=mainnet`. Replay runs separately and makes no venue writes. Partition state per environment. Executable 1Click quotes are mainnet-only.
15. **The UI shows confirmed state.**
    - Label pending items.
    - Label every claim as replay, testnet, dry quote or mainnet.
    - Copy: no "lock", "protect", "insure" or "guarantee", and no claims that the entry works offline.
16. **Tests.**
    - Use `bun test`.
    - Keep pure logic in `shared/`, with unit tests.
    - When adding venue signing, add SDK golden vectors with and without `expiresAfter` to check TypeScript and Rust against the same bytes.

## Key facts (verify at runtime)

**Hyperliquid**
- Mainnet `https://api.hyperliquid.xyz`, testnet `https://api.hyperliquid-testnet.xyz`, websocket `wss://<host>/ws`.
- **L1 signing:** Reproduce the official SDK's action hash, including the vault marker and `expiresAfter` bytes when present (section 19).
- **Nonces:** milliseconds, 100 highest per signer, inside (T − 2 days, T + 1 day).
- **Agents:** 1 unnamed plus 3 named per account. Name ours `baghedge valid_until <timestamp>`. The venue allows same-address transfers through `agentSendAsset`. Baghedge's guard refuses all transfers, withdrawals, and agent approvals.
- **Venue numbers:** minimum order $10. SOL max leverage 20x (maintenance 2.5%). The mark price triggers TP/SL.

**1Click**
- Base URL: `https://1click.chaindefuser.com`.
- Base USDC: `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` (6 decimals).
- HyperCore perps USDC: `1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054` (8 decimals).
- The `sendAsset` token is `USDC:0x6d1e7cde53ba9467b783cb7c530ce054`. Never use `usdSend`.

**OutLayer**
- Build for `wasm32-wasip2`; it's required for both signing keys and HTTP.
- Use `fn main()` in a binary crate and keep stdout under the guard's 900-byte budget. Confirm the cap for the chosen transport.
- The current `bind: "wasm"` probe needs a direct `WasmUrl` run with `{"operation":"public_key"}`. The HTTPS project endpoint requires a separate project-bound build (section 22).

## Where to look in `docs/BAGHEDGE_CONTEXT.md`

| Sections | Topic |
| --- | --- |
| 7–12 | UX, flows, exposure table, state labels |
| 13–15 | Repo, environments, conventions |
| 16–17 | Types and the internal API |
| 18 | Policy (EIP-712), states, scheduler, sizing, price bounds, recovery stop |
| 19 | Hyperliquid: info, websocket, actions, signing, nonces |
| 20 | 1Click funding and payout |
| 21 | Solana reads |
| 22 | The guard (OutLayer) |
| 23–24 | Margin and security |
| 25–27 | Plan, venue experiments, release checks |
| 28–31 | Replay, demo, README, submission |
