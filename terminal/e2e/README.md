# Privy test suite

Drives the terminal in a visible Chrome window, signed in with your real Privy account. Every step saves a screenshot and a log line. Clicks the app's own buttons only. Nothing that moves money runs unless you allow it for that run.

## How sign-in works

Privy login needs a Google sign-in or an emailed code, which a script can't do. So the suite reuses the session your own Chrome already has:

1. Sign in on your own Chrome at `http://localhost:3400` (email or Google).
2. The suite copies **only the storage parts** of your Chrome `Default` profile (Local Storage, Session Storage, WebStorage, Cookies, and the app's IndexedDB) into `~/.baghedge-e2e/profile` (mode 0700, outside the repo).
3. It opens that copy in **real Chrome** (`channel: "chrome"`). Chrome encrypts cookies with a key in your macOS keychain, and only real Chrome can read them; Playwright's bundled Chromium would see no cookies.

Signing has no popup: the app sets `showWalletUIs: false`, so the embedded wallet signs inside Privy's hidden frame, as it does for you. This only holds if the Privy dashboard doesn't force wallet UIs (`enforce_wallet_uis`).

Every run checks the signed-in email first and stops if it's a different account.

## Run it

```sh
cd terminal/e2e && bun install          # once
node run.mjs smoke                       # every page and tab, every explorer link
node run.mjs hedge-review --watch <SOL address> --sol 0.1
node run.mjs arm --allow approve,arm --watch <SOL address> --sol 0.1
node run.mjs close --allow command
node run.mjs activity                    # open every fill's explorer link
```

| Option | Default | What it does |
|---|---|---|
| `--url` | `http://localhost:3400` | The terminal to test. Use `:3401` for the local testnet copy. |
| `--email` | `test@vwakesahu.com` (or `BH_E2E_EMAIL`) | The account the run must be signed in as. |
| `--allow` | nothing | Rails to open for this run, comma separated (below). |
| `--watch` | none | A Solana address to watch if no SOL wallet is set. |
| `--sol` | `0.1` | The hedge amount typed on the keypad. |
| `--retries` | `1` | On any error, restart the flow from the top this many times. |
| `--fresh-profile` | off | Copy the Chrome session again (after you sign in again or switch accounts). |
| `--no-video` | recording on | Skip the recording. |
| `--shots` | off | A screenshot after every step. |
| `--stall` | `25` | Seconds with no change on screen before a step counts as stuck. |
| `--slow` | `250` | Milliseconds between actions, so you can follow along. |

## Flows

| Flow | What it does | Needs |
|---|---|---|
| `smoke` | Markets, Gainers, the SOL page, Trade and Hedge tabs, Portfolio (both accounts), Activity. Opens every explorer link on screen. | nothing |
| `hedge-review` | Adds the SOL wallet, types the amount, presses Review hedge. Signs in to the backend, looks up your hedge agent (the first lookup takes 5–10 s), approves it, drafts the policy, opens the review. | a funded Hedge account; `--allow approve` the first time |
| `arm` | `hedge-review`, then Sign and arm. Watches until Armed, then opens the explorer links. | `--allow approve,arm` |
| `close` | Disarm or Close hedge on the running rule, watches until it ends. | `--allow command` |
| `activity` | Opens every fill's explorer link on Activity. | nothing |

## Rails

Every call that changes state or moves money is **aborted** unless its rail is passed in `--allow`. A stray click can't move money, and the log shows `rail · blocked`.

| Rail | Call | What it does |
|---|---|---|
| `approve` | `POST /api/hl/approve-agent/submit` | Approves the hedge agent on the Hedge account |
| `arm` | `POST /api/hedges` | Arms a signed hedge policy |
| `command` | `POST /api/hedges/:id/close` and `/disarm` | Ends a hedge (closing buys back an open short) |
| `payout` | `POST /api/transfers/:id/send-asset/submit` | Sends USDC out of a Hyperliquid account |
| `deposit` | `POST /api/transfers/:id/deposit` | Reports a funding transfer |
| `quote` | `POST /api/transfers/quote` with `dry: false` | Creates an executable funding or payout quote |

Privy's logout call always gets a fake success, so closing the copy never signs your real Chrome out.

## Recording and the stuck detector

- **Every run is recorded** as one continuous video, `runs/<time>-<part>/<part>.mp4`: cursor and clicks drawn in, explorer links opened in the same tab and back. The video is finished even when a run fails or is stopped. `--no-video` turns it off; `--shots` adds a screenshot after every step.
- **Stuck:** progress means the screen changed (background price polling doesn't count). A heartbeat prints every 5 s; after `--stall` seconds (default 25) with no change, the run prints `⚠ STUCK` with what's on screen, what's still loading and the last console error, saves a picture, and ends. Waits for money in transit use 4 minutes. `node run.mjs selftest` proves it fires.
- **Done** is always the real control (the Done button, Sign and arm, Disarm), never matched text.

## Money flows

```sh
KEY=--sol-key ~/path/to/test-wallets/solana.json     # a test Solana wallet the page sees as "Test Wallet"
node run.mjs payout --role hedge --allow quote,payout $KEY
node run.mjs fund --role hedge --amount 0.1 --allow quote,solana $KEY
node run.mjs arm --sol 0.15 --allow approve,arm $KEY
node run.mjs close --allow command $KEY
node run.mjs fund --role trade --amount 0.2 --allow quote,solana $KEY
node run.mjs trade --coin SOL --usd 11 --allow approve $KEY
node run.mjs payout --role trade --allow quote,payout $KEY
```
The test wallet signs in node, only with `--allow solana`, and logs each transfer before signing it.

## What a run leaves

`e2e/runs/<time>-<flow>/` (gitignored):

- `shots/`: a screenshot after **every** step, an `-error` one when a step fails, one for each status change while watching, and one of each explorer page a View link opened.
- `log.jsonl`: one line per event:
  - `step`: name, ok, duration, URL, screenshot, the status line and toasts it ended on, every API call it made (method, path, status, error code), console errors.
  - `watch`: each status change during signing, arming and closing.
  - `rail`: blocked or allowed calls.
  - `view`: the explorer link clicked, the page it opened, its screenshot.
  - `account`, `page`, `flow-failed`.
- `summary.md`: a table of steps with ✓/✗, the outcome and a link to each screenshot.
- `video/`: with `--video`.

The terminal console shows the same steps live: `✓ review 2140ms 007-review.png`.

## Explorer links

The app links results to the Hyperliquid explorer (`app.hyperliquid.xyz/explorer`, or `app.hyperliquid-testnet.xyz` on testnet):

- **Fills** link to their transaction (`/explorer/tx/<hash>`), from the `hash` Hyperliquid returns with each fill.
- **Agent approval, arm, close** have no transaction page of their own (they're signed Hyperliquid actions), so their toasts link the account's history (`/explorer/address/<account>`), where they show.
- **Account pills** on Portfolio link the account.

`views()` in `lib.mjs` clicks each of these and saves a screenshot of the page it opened, so a run can be checked against the chain.

## Risks and cleanup

- **The copy is a live session.** Delete it when you're done: `rm -rf ~/.baghedge-e2e`.
- **Refresh tokens rotate.** If the copy refreshes the session first, your own Chrome may ask you to sign in again. Short runs usually don't trigger it. Then copy again with `--fresh-profile`.
- **Mainnet is real money.** Open a rail only for the run that needs it, and keep Hedge margin small.
