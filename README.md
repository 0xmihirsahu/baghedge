# Baghedge

**Trade perps. Hedge your bag.**

Baghedge is a Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet. You trade perps normally in a **Trade** account. Switch to **Wallet Hedge**, and a separate **Hedge** account opens a short when SOL falls through your price. The short is sized to the SOL actually sitting in your Phantom wallet, and it **shrinks automatically when you move SOL out**. Your manual trade isn't touched. USDC moves between Base and Hyperliquid through **NEAR Intents**. The hedge's trading key lives in an **OutLayer TEE** (Intel TDX on NEAR) and signs only what your signed policy allows.

Built at the NEAR Hackathon (track: Unstoppable DeFi).

- **Terminal (Vercel):** https://app.baghedge.xyz (source: [`terminal/`](terminal/))
- **Backend API (Render):** mainnet https://baghedge-api-mainnet.onrender.com/api/health (attested guard) · testnet sandbox https://baghedge-api.onrender.com/api/health (source: [`server/`](server/))
- **Guard (Rust, OutLayer):** [`guard/`](guard/)

## Try it

### 1. No wallet needed: replay
```sh
bun install && bun run demo:replay
```
This prints the two-account flow (manual long, hedge entry, wallet transfer, buyback, closes) with exposure after each step. **Replay uses sample fills.**

### 2. Live API (testnet sandbox), checked end to end
```sh
bun run smoke:api https://baghedge-api.onrender.com
```
→ 18 checks against the deployed backend: markets, accounts, wallet reads, policy draft, owner signature and arm, refusals, sign-in sessions, live events, and owner-signed disarm. It needs `.env.testwallets` (test keys) for the signing steps.

### 3. Run it yourself
```sh
cp .env.example .env.testnet      # fill in; see comments
bun run start:testnet             # API + hedge worker on :3001
bun run check                     # typecheck + 39 unit tests
cargo +stable test --locked --manifest-path guard/Cargo.toml   # guard tests
```
Open `http://localhost:3001/ops` (with `OPS_PAGE=1`) for the owner console. It connects a browser or phone wallet (WalletConnect) to fund, approve the agent, sign a hedge policy, close and pay out.

## What's verified live

**The full flow ran on mainnet with real funds:** fund through NEAR Intents, then an attested guard signs the hedge entry with its recovery stop, then SOL leaves the wallet and the hedge buys back reduce-only, then the owner closes the hedge while the manual Trade position stays put, then USDC is paid back to Base.

Every row links to on-chain or venue evidence. Raw records: [`docs/evidence/mainnet.jsonl`](docs/evidence/mainnet.jsonl) and [`docs/evidence/testnet.jsonl`](docs/evidence/testnet.jsonl).

| Step | Network | Evidence | Status |
| --- | --- | --- | --- |
| Manual order: place, cancel, fill (owner key) | Hyperliquid testnet | GTC `65304864631` open → canceled; IOC long 0.2 SOL filled @ 64.794 (`65304872996`) | ✅ |
| Manual order through a browser trading agent approved via our relay | Hyperliquid testnet | agent approved by owner signature; GTC `65309395507` open → canceled by the agent | ✅ |
| Fund the Hedge account from Base through NEAR Intents | **Mainnet** | Base tx [`0x2ba434e0…16ba`](https://basescan.org/tx/0x2ba434e01c6a154a23f3ab65e662d88152f4dba9ea9510918c2b62be017416ba) 15.0 USDC → Intents `SUCCESS` → Hyperliquid credit `0x6e6d6cf4…e6ed`: **14.683072 USDC usable margin** (~90 s) | ✅ |
| Guard build attested on OutLayer | **NEAR mainnet** | `public_key` run [`2oDKos4B…7buA`](https://api.outlayer.ai/attestations/by-tx/2oDKos4BKHkQXERKVKUUqiRD1DmsQnctVvHoaUBk7buA) by `anotherbaghedge.near`, WASM `ffe0e1dd…ced1c` → agent `0x38f05746…a70e`. REPORTDATA, measurements and Intel DCAP (`UpToDate`) independently verified. | ✅ |
| Guard agent approved on the Hedge account | **Mainnet** | `extraAgents(0x59c3…85cc)` lists `baghedge` → `0x38f05746…a70e` | ✅ |
| Owner-signed hedge policy armed (guard signer) | **Mainnet** | rule `0xb6e01a94…6309`: cap 0.28 SOL, entry 72.19, recovery 74.36 | ✅ armed |
| Guard-signed hedge entry with attached recovery stop | **Mainnet** | mark crossed 72.19 → guard signed in OutLayer ([`2m4DvN6S…vS3T`](https://api.outlayer.ai/attestations/by-tx/2m4DvN6S8A9j2HFvtopTH4STf6BVNtYwif5ojMLTvS3T), same attested WASM) → IOC sell `605230434689` **filled 0.28 SOL @ 72.205** (fill `0x91278997…0f58`); reduce-only recovery stop `605230434690` (trigger > 74.36, limit 75.08, 0.28) **open at the venue**; Trade account untouched. ~11 s from guard request to fill. | ✅ |
| Watched SOL moves out → reduce-only buyback | **Mainnet** | Phantom 0.40 → 0.1499 SOL → guard signed ([`9GFonDvJ…5BBx`](https://api.outlayer.ai/attestations/by-tx/9GFonDvJYMEFw9cmy6ucJAGu1oLm1xmjKY3BoL5j5BBx)) → reduce-only IOC `605233441503` **filled 0.14 SOL @ 72.203** (fill `0x67a9b704…cc0b`); hedge −0.28 → **−0.14**. Trade account unaffected (it held no position yet). | ✅ |
| Manual Trade long (separate account, own agent) | **Mainnet** | IOC long `605239853591` **filled 0.14 SOL @ 72.225** on Trade `0x80FD…6444` | ✅ |
| Owner closes the hedge; Trade position unchanged | **Mainnet** | owner-signed close → guard signed ([`BbsrLb94…2VDJ`](https://api.outlayer.ai/attestations/by-tx/BbsrLb945mjbCmAXcgVYe9dbDyx545asp9TsY8s32VDJ)) → reduce-only `605241804534` **filled 0.14 @ 72.262** (fill `0xd4150293…8602`); Hedge flat, no orders (stop `reduceOnlyCanceled`); **Trade still +0.14 SOL** | ✅ |
| Pay Hedge USDC back to Base | **Mainnet** | owner-signed `sendAsset` 13.5 USDC (`0x83ea1acf…df8c`) → Intents `SUCCESS` → Base tx [`0xb4b7bdef…f0a3`](https://basescan.org/tx/0xb4b7bdefc4261d3ccc9a0ccc4f043f53f3fd86a5da720bfedd649971a3e1f0a3): **13.29703 USDC received** by the owner (receipt checked on Base) | ✅ |
| Rule expiry without a crossing ends flat | Hyperliquid testnet | rule `0x243019ab…3b1a`: low 64.794 vs entry 64.76, expired with 0 actions | ✅ |

## How it works

```
 Phantom (watched SOL, read-only) ──► worker ◄── Hyperliquid mark / book / positions
                                        │
          owner-signed EIP-712 policy ──┤ journal (SQLite): cloid + nonce saved before every send
                                        ▼
                         OutLayer guard (TDX enclave, NEAR)  ── signs only policy-valid orders
                                        ▼
                        Hyperliquid Hedge account (separate master account)
 Base USDC ◄──── NEAR Intents 1Click ────► Hyperliquid perps USDC (Trade or Hedge)
```

- **Two accounts.** Trade and Hedge are different Hyperliquid master accounts. Aliases are rejected in the UI, the API and the guard.
- **Policy.** The Hedge owner signs one EIP-712 `HedgePolicy`: accounts, watched wallet, market, cap, entry, floor, recovery, buyback ceiling, expiry, required margin, and the guard agent and build hash. The TypeScript and Rust digests are cross-checked.
- **Worker** ([`server/worker.ts`](server/worker.ts)). For each Hedge account, one serialized tick does four things in order:
  1. reconcile every journaled order by client ID;
  2. confirm the recovery stop at the venue, and install a position stop if it's missing;
  3. decide entry, resize or close;
  4. reserve, sign, send, then reconcile again.

  If a send's result is unknown, the worker never retries it blind. Every buy is reduce-only.
- **Guard** ([`guard/`](guard/)). Rust `wasm32-wasip2` on OutLayer. It rebuilds each order from typed fields, checks it against the owner's policy (accounts, market, prices, size, reduce-only, expiry and cloid binding), and signs with a key that never leaves the TEE. It never signs raw bytes, transfers or withdrawals. The worker checks the recovered signer before anything reaches Hyperliquid.
- **Funding and payout** ([`server/intents.ts`](server/intents.ts)). 1Click `EXACT_INPUT` quotes. Refunds always go back to the owner. Credit is confirmed against the Hyperliquid balance, not only the provider's status.

## Trust boundary and disclosed risks
- **The owner keeps control:** funding, agent approval, the policy, disarm, close and payout are all owner wallet signatures. The guard agent can't withdraw or transfer, because Hyperliquid forbids it for agents.
- **What a compromised signer could do:** trade the Hedge account's posted margin badly. It can't move funds out. The dedicated Hedge account caps the loss at the margin posted.
- **One guard, an agent per user:** the multi-owner guard derives a separate Hyperliquid agent for every Hedge owner inside the enclave. Each owner approves only their own agent, and a policy naming another owner's agent is refused (verified live on mainnet).
- **Guard state:** the guard is stateless. Cumulative size caps and data freshness are enforced by the worker, not inside the enclave (documented in [`docs/BAGHEDGE_CONTEXT.md`](docs/BAGHEDGE_CONTEXT.md) §22).
- **Disclosed:** the guard's NEAR execution account (`anotherbaghedge.near`) had its key shared during development, and the team chose not to rotate it. Someone holding it could request extra guard signatures under **any user's** public signed policy, trading that user's Hedge margin within the policy's limits, and could spend the account's NEAR. They can **never withdraw** funds. `GET /api/health` → `disclosures` carries this so the app can show it before funding.
- **Platform trust:** Hyperliquid (venue and mark price), OutLayer/Intel TDX, NEAR Intents, and Solana RPC data. Auto-deleveraging and funding can change the outcome.

## Docs
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md): wiring the terminal to the backend, step by step.
- [`docs/API.md`](docs/API.md): the full API contract.
- [`docs/BAGHEDGE_CONTEXT.md`](docs/BAGHEDGE_CONTEXT.md): product, engineering and security brief.
- [`AGENTS.md`](AGENTS.md): engineering rules (no floats for money, journal before writing, reconcile before retrying, and more).

## Libraries
Bun, TypeScript, [`@nktkas/hyperliquid`](https://github.com/nktkas/hyperliquid), viem, WalletConnect, `near-api-js`, `@solana/web3.js` (scripts); Rust `k256`, `sha3`, `serde`, `rmp-serde` (guard); Next.js, React, lightweight-charts and the Solana wallet adapter (terminal). Hyperliquid, NEAR Intents 1Click, OutLayer and FastFS.

## License
[Business Source License 1.1](LICENSE). The source is public. You may read, copy, modify and use it **non-commercially**, but production or commercial use needs a license from Baghedge. Each version converts to GPL-2.0-or-later on 2030-11-15, or four years after it's first published, whichever comes first.
