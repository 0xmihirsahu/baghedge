// baghedge Privy test suite: real Chrome on a copy of your signed-in Chrome profile, visible, with rails.
// every step: screenshot after, plus the API calls, console errors, status line and toasts it caused (log.jsonl).
// see e2e/README.md
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const PROFILE = process.env.BH_E2E_PROFILE ?? path.join(os.homedir(), ".baghedge-e2e", "profile");
const CHROME = process.env.BH_CHROME_PROFILE ?? path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default");

// calls that change state or move money. each is aborted unless its name is passed in `allow`
export const RAILS = {
  approve: { method: "POST", re: /\/api\/hl\/approve-agent\/submit$/ },
  arm: { method: "POST", re: /\/api\/hedges$/ },
  command: { method: "POST", re: /\/api\/hedges\/0x[\da-f]{64}\/(close|disarm)$/i },
  payout: { method: "POST", re: /\/api\/transfers\/[^/]+\/send-asset\/submit$/ },
  deposit: { method: "POST", re: /\/api\/transfers\/[^/]+\/deposit$/ },
  quote: { method: "POST", re: /\/api\/transfers\/quote$/, live: (body) => /"dry"\s*:\s*false/.test(body ?? "") },
};

// copies only the storage that holds the session (never the whole profile), into a 0700 folder outside the repo
export function copyProfile(port) {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(path.join(PROFILE, "Default", "IndexedDB"), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(PROFILE), 0o700);
  for (const part of ["Local Storage", "Session Storage", "Cookies", "WebStorage"]) {
    const from = path.join(CHROME, part);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(PROFILE, "Default", part), { recursive: true });
  }
  const idb = path.join(CHROME, "IndexedDB", `http_localhost_${port}.indexeddb.leveldb`);
  if (fs.existsSync(idb)) fs.cpSync(idb, path.join(PROFILE, "Default", "IndexedDB", path.basename(idb)), { recursive: true });
  execSync(`find "${PROFILE}" -name LOCK -delete`);
}

export async function open({ url, email, allow = [], slowMo = 120, video = false, name = "run" }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(HERE, "runs", `${stamp}-${name}`);
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
  const logFile = path.join(dir, "log.jsonl");
  const write = (o) => {
    const line = { at: new Date().toISOString(), ...o };
    fs.appendFileSync(logFile, JSON.stringify(line) + "\n");
    const tag = o.type === "step" ? `${o.ok ? "✓" : "✗"} ${o.step}` : o.type;
    console.log(new Date().toISOString().slice(11, 19), tag, o.type === "step" ? `${o.ms}ms ${o.shot ? path.basename(o.shot) : ""}${o.error ? " · " + o.error : ""}` : JSON.stringify(o).slice(0, 220));
  };

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    slowMo,
    viewport: { width: 1440, height: 860 },
    args: ["--window-size=1480,960"],
    ...(video ? { recordVideo: { dir: path.join(dir, "video"), size: { width: 1440, height: 860 } } } : {}),
  });

  // the copy must never end the real session
  await ctx.route(/auth\.privy\.io\/api\/v1\/sessions\/logout/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  // rails: state-changing calls are aborted unless allowed for this run
  const allowed = new Set(allow);
  await ctx.route(/\/api\//, (r) => {
    const req = r.request();
    for (const [key, rail] of Object.entries(RAILS)) {
      if (req.method() !== rail.method || !rail.re.test(new URL(req.url()).pathname)) continue;
      if (rail.live && !rail.live(req.postData())) continue;
      if (allowed.has(key)) {
        write({ type: "rail", rail: key, action: "allowed", path: new URL(req.url()).pathname });
        break;
      }
      write({ type: "rail", rail: key, action: "blocked", path: new URL(req.url()).pathname });
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });

  // the API trail: every baghedge and Hyperliquid call with its status and error code (bodies never logged whole)
  let api = [];
  let errors = [];
  const watchPage = (p) => {
    p.on("response", async (res) => {
      const u = new URL(res.url());
      if (!u.pathname.startsWith("/api/") && !/hyperliquid/.test(u.host)) return;
      let code;
      if (res.status() >= 400) code = await res.json().then((j) => j.error ?? j.message, () => undefined).catch(() => undefined);
      const info = /hyperliquid/.test(u.host) ? (res.request().postData() ?? "").match(/"type"\s*:\s*"(\w+)"/)?.[1] : undefined;
      api.push({ m: res.request().method(), p: u.host.includes("localhost") ? u.pathname : `${u.host}${u.pathname}${info ? `:${info}` : ""}`, s: res.status(), ...(code ? { code } : {}) });
    });
    p.on("requestfailed", (req) => {
      const u = new URL(req.url());
      if (u.pathname.startsWith("/api/") || /privy|hyperliquid/.test(u.host)) api.push({ m: req.method(), p: u.pathname, s: 0, failed: req.failure()?.errorText });
    });
    p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text().slice(0, 300)}`));
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  };
  ctx.on("page", (p) => {
    watchPage(p);
    write({ type: "page", url: p.url() || "(opening)" });
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  watchPage(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  let n = 0;
  const shot = async (label, p = page) => {
    const f = path.join(dir, "shots", `${String(++n).padStart(3, "0")}-${label.replace(/[^\w-]+/g, "-")}.png`);
    await p.screenshot({ path: f }).catch(() => {});
    return f;
  };
  // what the user sees as the outcome: the ticket's status line, inline errors, and toasts
  const status = () =>
    page
      .evaluate(() => ({
        // live regions minus the rolling numbers (balances, prices), which aren't outcomes
        live: [...document.querySelectorAll("[aria-live]")].map((e) => e.textContent?.trim()).filter((t) => t && !/^[-−]?\$?[\d,.]+%?( total| SOL)?$/.test(t)),
        toasts: [...document.querySelectorAll(".toast-in")].map((e) => e.textContent?.trim()),
        dialog: document.querySelector('[role="dialog"][aria-hidden="false"], [role="dialog"]:not([aria-hidden])')?.textContent?.trim().slice(0, 200) ?? null,
      }))
      .catch(() => ({ live: [], toasts: [], dialog: null }));

  const steps = [];
  // one operation: run it, let the UI settle, screenshot, log what it did
  const step = async (name, fn, { settle = 900 } = {}) => {
    api = [];
    errors = [];
    const t0 = Date.now();
    try {
      await fn(page);
      await page.waitForTimeout(settle);
      const f = await shot(name);
      const rec = { type: "step", step: name, ok: true, ms: Date.now() - t0, url: page.url(), shot: f, status: await status(), api, errors };
      write(rec);
      steps.push(rec);
    } catch (e) {
      const f = await shot(`${name}-error`);
      const rec = { type: "step", step: name, ok: false, ms: Date.now() - t0, url: page.url(), shot: f, error: String(e.message ?? e).split("\n")[0], status: await status(), api, errors };
      write(rec);
      steps.push(rec);
      throw e;
    }
  };

  // a long step (signing, arming, closing): read the status every second, screenshot each change, stop on done or a failure
  const watch = async (name, done, { timeout = 120_000 } = {}) => {
    const t0 = Date.now();
    let last = "";
    while (Date.now() - t0 < timeout) {
      const s = await status();
      const text = [...s.live, ...s.toasts].join(" | ");
      if (text !== last) {
        last = text;
        write({ type: "watch", step: name, text, shot: await shot(`${name}-watch`) });
      }
      if (done(text)) return text;
      if (/failed|try again|couldn't|can't|refused/i.test(text)) throw new Error(`${name}: ${text}`);
      await page.waitForTimeout(1000);
    }
    throw new Error(`${name}: timed out after ${timeout / 1000}s (last: ${last || "nothing"})`);
  };

  // open every "View" link on screen (toasts, activity rows, account pills), screenshot the explorer page, close it
  const views = async (name, max = 4) => {
    const links = page.locator('.toast-in a, a[aria-label="View transaction"], a[aria-label="View on the Hyperliquid explorer"]');
    const count = Math.min(await links.count(), max);
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute("href");
      await step(`${name}-view-${i + 1}`, async () => {
        const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 15_000 }), link.click()]);
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await popup.waitForTimeout(4000);
        write({ type: "view", href, url: popup.url(), title: await popup.title().catch(() => ""), shot: await shot(`${name}-explorer-${i + 1}`, popup) });
        await popup.close();
      });
    }
    if (!count) write({ type: "view", note: "no View links on screen" });
    return count;
  };

  // refuse to run on the wrong account
  const signedIn = async () => {
    await page.waitForFunction((e) => document.body.innerText.includes(e), email, { timeout: 30_000 }).catch(() => {});
    const ok = await page.evaluate((e) => document.body.innerText.includes(e), email);
    write({ type: "account", expected: email, ok });
    if (!ok) throw new Error(`not signed in as ${email}: copy the profile again (--fresh-profile) after signing in on Chrome`);
  };

  const close = async () => {
    const lines = [`# ${name} · ${stamp}`, "", `${url} · signed in as ${email} · allowed: ${allow.join(", ") || "nothing"}`, "", "| | step | ms | screenshot | outcome |", "|---|---|---|---|---|"];
    for (const s of steps) lines.push(`| ${s.ok ? "✓" : "✗"} | ${s.step} | ${s.ms} | [${path.basename(s.shot)}](shots/${path.basename(s.shot)}) | ${(s.error ?? [...s.status.live, ...s.status.toasts].join(" · ")).replace(/\|/g, "/").slice(0, 140)} |`);
    fs.writeFileSync(path.join(dir, "summary.md"), lines.join("\n") + "\n");
    await ctx.close();
    console.log("run folder:", dir);
  };

  return { page, ctx, dir, step, watch, views, shot, status, signedIn, close, log: write };
}
