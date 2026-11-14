# AGENTS.md: Baghedge

Rules for AI coding agents (Cursor, Codex, Claude) working in this repo.
- Full context: `docs/BAGHEDGE_CONTEXT.md`. Section numbers below point into it.
- The canonical product brief is revision 8. If they disagree, revision 8 wins.

## What this is

- A Hyperliquid trading terminal, plus a wallet-aware SOL hedge (**Wallet Hedge** mode). Built for the NEAR Hackathon; the cutoff is 2026-11-14 23:59 UTC.
- **Two accounts.** The **Trade** account (manual orders) and the **Hedge** account (the hedge short) are two distinct Hyperliquid master accounts.
- **The worker (`server/`) runs the hedge.**
  - It enters on a mark crossing: a bounded IOC sell with a reduce-only recovery stop attached (`normalTpsl`).
  - It reduces the hedge when the watched SOL drops.
  - It closes on recovery, at expiry, or when the owner asks.
- **The guard (`guard/`)** is Rust built for `wasm32-wasip2`, running on OutLayer. It signs hedge actions as a named, expiring Hyperliquid agent, within the owner's EIP-712 policy.
- **Funding** uses NEAR Intents 1Click: Base USDC ↔ HyperCore perps USDC.

## Layout and commands

```text
src/       Vite + React terminal (browser only)
server/    Bun API + worker (bun:sqlite)
shared/    pure, browser-safe logic (units, precision, exposure, policy, wire builders)
fixtures/  replay data + golden Hyperliquid vectors
guard/     standalone Rust crate (wasm32-wasip2)
scripts/   venue experiments, replay, quote checks, build_github_wasm.sh
```

- `bun run dev` · `bun run dev:server` · `bun run build` · `bun run check` · `bun run demo:replay` · `bun run verify:quotes`
- Guard build: `./scripts/build_github_wasm.sh --dir ./guard --target wasm32-wasip2 --twice --keep`. **Never omit `--target`**; the script defaults to P1, and P1 can't hold signing keys.

## Hard rules

1. **No floats for money or sizes.**
   - Use bigint lamports, bigint market lots (1 lot = 10^-szDecimals) and bigint token base units.
   - Do price math with a decimal library.
   - Use decimal strings at JSON boundaries. Convert to `number` only for charts and display. (Section 15)
2. **Read market constants at runtime.** Get the asset ID, `szDecimals` and `maxLeverage` from `meta`. Never hardcode SOL's index (observed 5) or decimals (observed 2). (Section 19)
3. **Precision.**
   - Round sizes down to `szDecimals`.
   - Prices: at most 5 significant figures and at most `6 − szDecimals` decimals.
   - Round toward safety: a sell floor rounds up, a buy ceiling rounds down.
4. **Journal before writing.** Persist the action ID, cloid and nonce before sending any venue action or transfer.
5. **Reconcile before retrying.**
   - An unknown result stays pending until `orderStatus`, fills and positions rule it out.
   - An HTTP 200 can carry per-order errors, and IOC fills can be partial.
6. **One writer per `(env, hedgeAddress)`.** Prefer one IOC in flight.
7. **Query Hyperliquid info with the master address,** never the agent's address.
8. **Trade ≠ Hedge.** Reject equal accounts in the UI, the adapter and the signing path.
9. **Entry retries** only after a confirmed zero fill, inside the signed band and window. A partial fill ends opening. Never top it up.
10. **Recovery stop status.**
    - Show **Recovery stop active** only after the venue confirms it.
    - After a partial fill, install a position stop. Until it's confirmed, show **Recovery stop missing** or **Checking recovery stop**.
11. **Never** use `scheduleCancel` for expiry. **Never** build a resting venue entry; that's experiment only.
12. **Guard rules.** Size limit: output ≤ 900 bytes. (Section 22)
    - Build every action from validated fields. Never sign raw digests or bytes.
    - Refuse:
      - the wrong account or market;
      - a buy that isn't reduce-only;
      - a cumulative cap breach, counting unresolved sells;
      - a price outside the bounds;
      - any transfer.
13. **Secrets never go in the browser bundle or the logs:** RPC keys, `INTENTS_JWT`, the OutLayer payment key, any private key.
14. **Environments:** `replay | testnet | mainnet`.
    - Partition state per environment.
    - Replay disables writes.
    - Executable 1Click routes are mainnet-only.
15. **The UI shows confirmed state.**
    - Label pending items.
    - Label every claim as replay, testnet, dry quote or mainnet.
    - Copy: no "lock", "protect", "insure" or "guarantee", and no claims that the entry works offline.
16. **Tests.**
    - Use `bun test`.
    - Keep pure logic in `shared/`, with unit tests.
    - Golden vectors in `fixtures/vectors/` keep the TypeScript and Rust Hyperliquid action bytes identical.

## Key facts (verify at runtime)

**Hyperliquid**
- Mainnet `https://api.hyperliquid.xyz`, testnet `https://api.hyperliquid-testnet.xyz`, websocket `wss://<host>/ws`.
- **L1 signing:** `msgpack(action) ‖ nonce (8 bytes, big-endian) ‖ 0x00` → keccak256 → EIP-712 `Agent { source: "a" | "b", connectionId }`, domain `Exchange / 1 / chainId 1337 / 0x0`.
- **Nonces:** milliseconds, 100 highest per signer, inside (T − 2 days, T + 1 day).
- **Agents:** 1 unnamed plus 3 named per account. Name ours `baghedge valid_until <timestamp>`. Agents can't transfer, withdraw or approve agents.
- **Venue numbers:** minimum order $10. SOL max leverage 20x (maintenance 2.5%). The mark price triggers TP/SL.

**1Click**
- Base URL: `https://1click.chaindefuser.com`.
- Base USDC: `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` (6 decimals).
- HyperCore perps USDC: `1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054` (8 decimals).
- The `sendAsset` token is `USDC:0x6d1e7cde53ba9467b783cb7c530ce054`. Never use `usdSend`.

**OutLayer**
- Build for `wasm32-wasip2`; it's required for both signing keys and HTTP.
- Stdout is capped at 900 bytes. Use `[[bin]]` with `fn main()`, and flush stdout.
- Mainnet contract `outlayer.near`. HTTPS: `POST https://api.outlayer.ai/call/{owner}/{project}` with `X-Payment-Key`.

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