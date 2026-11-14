// node e2e/run.mjs <flow> [options]. flows and options: e2e/README.md
import { copyProfile, open, PROFILE } from "./lib.mjs";
import fs from "node:fs";

const argv = process.argv.slice(2);
const flow = argv[0];
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const url = opt("url", "http://localhost:3400");
const email = opt("email", process.env.BH_E2E_EMAIL ?? "test@vwakesahu.com");
const allow = String(opt("allow", "")).split(",").filter(Boolean);
const retries = Number(opt("retries", 1));
const watchAddr = opt("watch", null);
const sol = String(opt("sol", "0.1"));
const role = String(opt("role", "hedge"));
const amount = String(opt("amount", "0.1"));
const solKey = opt("sol-key", process.env.BH_E2E_SOL_KEY ?? null);

const FLOWS = {
  // every page and tab, then every explorer link on screen
  async smoke(t) {
    await t.step("markets", (p) => p.goto(`${url}/markets`), { settle: 2500 });
    await t.step("gainers", (p) => p.getByRole("button", { name: "Gainers", exact: true }).click());
    await t.step("sol-page", (p) => p.goto(`${url}/`), { settle: 3000 });
    await t.step("trade-tab", (p) => p.getByRole("button", { name: "Trade", exact: true }).first().click());
    await t.step("hedge-tab", (p) => p.getByRole("button", { name: "Hedge", exact: true }).first().click());
    await t.step("portfolio", (p) => p.goto(`${url}/portfolio`), { settle: 3000 });
    await t.views("portfolio-trade");
    await t.step("hedge-account", (p) => p.getByRole("button", { name: "Hedge", exact: true }).last().click(), { settle: 2500 });
    await t.views("portfolio-hedge");
    await t.step("activity", (p) => p.goto(`${url}/activity`), { settle: 3000 });
    await t.views("activity");
  },

  // sign in to the backend, find and approve the hedge agent, draft the policy, open the review. nothing is armed
  async "hedge-review"(t) {
    await ensureSol(t);
    await t.step("hedge-page", (p) => p.goto(`${url}/`), { settle: 3000 });
    await t.step("amount", async (p) => {
      for (let i = 0; i < 8; i++) await p.getByRole("button", { name: "Delete", exact: true }).click();
      for (const k of sol) await p.getByRole("button", { name: k, exact: true }).click();
    });
    await t.step("review", (p) => p.getByRole("button", { name: /Review hedge/ }).click(), { settle: 500 });
    await t.watch("review-ready", (s) => /Sign and arm/.test(s) || false, { timeout: 90_000 }).catch(async (e) => {
      // the review dialog is the success signal; the status line only carries progress and errors
      if (await t.page.getByRole("button", { name: "Sign and arm" }).isVisible().catch(() => false)) return;
      throw e;
    });
    await t.step("review-open", () => t.page.getByRole("button", { name: "Sign and arm" }).waitFor({ timeout: 5000 }));
  },

  // the review, then sign and arm (needs --allow approve,arm), then watch it go live and open its explorer link
  async arm(t) {
    await FLOWS["hedge-review"](t);
    await t.step("sign-and-arm", (p) => p.getByRole("button", { name: "Sign and arm" }).click(), { settle: 500 });
    await t.watch("armed", (s) => /Armed|Entry pending|Recovery stop/.test(s), { timeout: 90_000 });
    await t.views("armed");
  },

  // disarm or close the running hedge (needs --allow command), then watch it end
  async close(t) {
    await t.step("hedge-page", (p) => p.goto(`${url}/`), { settle: 4000 });
    await t.step("close", (p) => p.getByRole("button", { name: /^(Disarm|Close hedge)$/ }).click(), { settle: 500 });
    await t.watch("closed", (s) => /Disarmed|Closed|Closing/.test(s), { timeout: 120_000 });
    await t.views("closed");
  },

  // connect the test Solana wallet (--sol-key) through the app's own sheet
  async "connect-sol"(t) {
    await connectSol(t);
  },

  // Add funds from the connected Solana wallet, through NEAR Intents, to --role (needs --allow quote,solana)
  async fund(t) {
    await connectSol(t);
    await t.step("portfolio", (p) => p.goto(`${url}/portfolio`), { settle: 3000 });
    await t.step(`${role}-tab`, (p) => p.getByRole("button", { name: role === "trade" ? "Trade" : "Hedge", exact: true }).last().click(), { settle: 2500 });
    await t.step("add-funds", (p) => p.getByRole("button", { name: "Add funds", exact: true }).first().click(), { settle: 1200 });
    await t.step("sheet-account", (p) => p.getByRole("dialog", { name: "Add funds" }).getByRole("button", { name: role === "trade" ? "Trade" : "Hedge", exact: true }).click());
    await t.step("amount", (p) => p.getByLabel("Amount").fill(amount), { settle: 500 });
    await t.watch("quote", (s) => /You get/.test(s), { timeout: 30_000 });
    await t.step("quote-shown", () => Promise.resolve());
    await t.step("send", (p) => p.getByRole("button", { name: new RegExp(`^Add to ${role === "trade" ? "Trade" : "Hedge"}$`) }).click(), { settle: 500 });
    await t.watch("funding", (s) => /\bDone\b/.test(s), { timeout: 600_000 });
    await t.views("funded", 6);
    await t.step("track-links", async (p) => {
      for (const a of await p.locator('[role="dialog"] a').all()) t.log({ type: "link", text: (await a.textContent())?.trim(), href: await a.getAttribute("href") });
    });
  },

  // Pay out the --role account's max back to the Solana wallet (needs --allow quote,payout)
  async payout(t) {
    await connectSol(t);
    await t.step("portfolio", (p) => p.goto(`${url}/portfolio`), { settle: 3000 });
    await t.step(`${role}-tab`, (p) => p.getByRole("button", { name: role === "trade" ? "Trade" : "Hedge", exact: true }).last().click(), { settle: 2500 });
    await t.step("pay-out", (p) => p.getByRole("button", { name: "Pay out", exact: true }).first().click(), { settle: 2500 });
    await t.step("max", (p) => p.getByRole("button", { name: /^Max / }).click(), { settle: 500 });
    await t.watch("quote", (s) => /They get/.test(s), { timeout: 30_000 });
    await t.step("quote-shown", () => Promise.resolve());
    await t.step("send", (p) => p.getByRole("button", { name: /^Send \$/ }).click(), { settle: 500 });
    await t.watch("payout", (s) => /\bDone\b/.test(s), { timeout: 600_000 });
    await t.views("paid", 6);
  },

  // a real $10 Long on --coin from the Trade account, then Close (needs --allow approve)
  async trade(t) {
    const coin = String(opt("coin", "SOL"));
    await t.step("market", (p) => p.goto(coin === "SOL" ? `${url}/` : `${url}/markets/${coin}`), { settle: 3500 });
    await t.step("trade-tab", (p) => p.getByRole("button", { name: "Trade", exact: true }).first().click());
    await t.step("usd", async (p) => {
      for (let i = 0; i < 6; i++) await p.getByRole("button", { name: "Delete", exact: true }).click();
      for (const k of String(opt("usd", "11"))) await p.getByRole("button", { name: k, exact: true }).click();
    });
    await t.step("long", (p) => p.getByRole("button", { name: "Long", exact: true }).click(), { settle: 500 });
    await t.watch("filled", (s) => /Filled/.test(s), { timeout: 90_000 });
    await t.views("filled");
    await t.step("position", (p) => p.waitForTimeout(16_000), { settle: 500 });
    await t.step("close", (p) => p.getByRole("button", { name: "Close", exact: true }).first().click(), { settle: 500 });
    await t.watch("closed", (s) => /closed/i.test(s), { timeout: 90_000 });
    await t.views("closed");
  },

  // every fill's explorer link
  async activity(t) {
    await t.step("activity", (p) => p.goto(`${url}/activity`), { settle: 3000 });
    await t.views("activity", 6);
  },
};

// connect the test wallet through the sheet, unless a SOL wallet is already shown
async function connectSol(t) {
  const has = !(await t.page.getByRole("button", { name: /Add SOL to hedge/ }).first().isVisible().catch(() => false));
  if (has) return;
  await t.step("add-sol", (p) => p.getByRole("button", { name: /Add SOL to hedge/ }).first().click());
  await t.step("solana-wallet", (p) => p.getByRole("button", { name: /Connect a Solana wallet/ }).click(), { settle: 800 });
  await t.step("test-wallet", (p) => p.getByRole("button", { name: /Test Wallet/ }).click(), { settle: 3000 });
}

// the hedge needs a SOL wallet: watch one through the sheet if --watch is given and none is set
async function ensureSol(t) {
  const has = !(await t.page.getByRole("button", { name: /Add SOL to hedge/ }).first().isVisible().catch(() => false));
  if (has || !watchAddr) return;
  await t.step("add-sol", (p) => p.getByRole("button", { name: /Add SOL to hedge/ }).first().click());
  await t.step("watch-choice", (p) => p.getByRole("button", { name: /Watch an address/ }).click());
  await t.step("watch-fill", (p) => p.getByPlaceholder("Solana address").fill(watchAddr));
  await t.step("watch-submit", (p) => p.getByRole("button", { name: "Watch", exact: true }).click(), { settle: 2500 });
}

if (!FLOWS[flow]) {
  console.log(`flows: ${Object.keys(FLOWS).join(", ")}\nsee e2e/README.md`);
  process.exit(1);
}
if (opt("fresh-profile", false) || !fs.existsSync(PROFILE)) {
  copyProfile(new URL(url).port || "80");
  console.log("copied the Chrome session into", PROFILE);
}

// any error: restart the flow from the top (the rails make a rerun safe), up to --retries times
for (let attempt = 0; attempt <= retries; attempt++) {
  const t = await open({ url, email, allow, solKey, name: `${flow}${attempt ? `-retry${attempt}` : ""}`, video: !!opt("video", false), slowMo: Number(opt("slow", 120)) });
  try {
    await t.signedIn();
    await FLOWS[flow](t);
    await t.close();
    process.exit(0);
  } catch (e) {
    t.log({ type: "flow-failed", flow, attempt, error: String(e.message ?? e).split("\n")[0] });
    await t.close();
    if (attempt === retries) process.exit(1);
  }
}
