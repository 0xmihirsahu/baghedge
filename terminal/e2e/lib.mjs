// baghedge Privy test suite: real Chrome on a copy of your signed-in Chrome profile, visible, with rails.
// every step: screenshot after, plus the API calls, console errors, status line and toasts it caused (log.jsonl).
// see e2e/README.md
import { chromium } from "playwright";
import { Keypair, SystemInstruction, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
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
// origin: the app's URL; its IndexedDB folder is <scheme>_<host>_<port or 0>
export function copyProfile(origin) {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(path.join(PROFILE, "Default", "IndexedDB"), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(PROFILE), 0o700);
  for (const part of ["Local Storage", "Session Storage", "Cookies", "WebStorage"]) {
    const from = path.join(CHROME, part);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(PROFILE, "Default", part), { recursive: true });
  }
  const u = new URL(origin);
  const idb = path.join(CHROME, "IndexedDB", `${u.protocol.slice(0, -1)}_${u.hostname}_${u.port || 0}.indexeddb.leveldb`);
  if (fs.existsSync(idb)) fs.cpSync(idb, path.join(PROFILE, "Default", "IndexedDB", path.basename(idb)), { recursive: true });
  execSync(`find "${PROFILE}" -name LOCK -delete`);
}

// solKey: a Solana keypair file ({ solana: { secretKeyArray } }) for a test wallet the page sees as "Test Wallet".
// it signs in node, only when the run allows the "solana" rail, and logs what each transaction does first
// video (on by default): one continuous recording of the whole flow, saved as <flow>.mp4 when the run ends, even on a
// failure or an interrupt. screenshots are off; a failing step still keeps one, for debugging
// stall: seconds with no change on screen and no network answer before a step counts as stuck
export async function open({ url, email, allow = [], slowMo = 250, video = true, shots = false, name = "run", solKey = null, stall = 20 }) {
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

  // a recording shows no mouse: draw one, with a ripple on each click
  if (video)
    await ctx.addInitScript(() => {
      const css = "position:fixed;z-index:2147483647;pointer-events:none;border-radius:50%;transform:translate(-50%,-50%);";
      const add = () => {
        if (document.getElementById("__cursor")) return;
        const dot = document.createElement("div");
        dot.id = "__cursor";
        dot.style.cssText = css + "width:18px;height:18px;background:rgba(255,255,255,.9);border:2px solid #0b0908;box-shadow:0 0 0 2px rgba(240,100,90,.8);left:-40px;top:-40px;transition:left .08s linear,top .08s linear;";
        document.documentElement.appendChild(dot);
        addEventListener("mousemove", (e) => ((dot.style.left = e.clientX + "px"), (dot.style.top = e.clientY + "px")), true);
        addEventListener("mousedown", (e) => {
          const r = document.createElement("div");
          r.style.cssText = css + `left:${e.clientX}px;top:${e.clientY}px;width:16px;height:16px;border:2px solid #f0645a;transition:all .45s ease-out;opacity:1;`;
          document.documentElement.appendChild(r);
          requestAnimationFrame(() => Object.assign(r.style, { width: "56px", height: "56px", opacity: "0" }));
          setTimeout(() => r.remove(), 500);
        }, true);
      };
      if (document.readyState === "loading") addEventListener("DOMContentLoaded", add);
      else add();
    });

  // the test Solana wallet: a wallet-standard wallet in the page, its key in node
  if (solKey) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(solKey, "utf8")).solana.secretKeyArray));
    await ctx.exposeFunction("__bhSolSign", (b64) => {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      const keys = tx.message.staticAccountKeys;
      const what = tx.message.compiledInstructions.map((ix) => {
        const program = keys[ix.programIdIndex];
        if (program.equals(SystemProgram.programId)) {
          try {
            const d = SystemInstruction.decodeTransfer(new TransactionInstruction({ programId: program, keys: ix.accountKeyIndexes.map((i) => ({ pubkey: keys[i], isSigner: false, isWritable: true })), data: Buffer.from(ix.data) }));
            return `transfer ${Number(d.lamports) / 1e9} SOL → ${d.toPubkey.toBase58()}`;
          } catch {}
        }
        return `program ${program.toBase58()}`;
      });
      if (!allowed.has("solana")) {
        write({ type: "rail", rail: "solana", action: "blocked", what });
        throw new Error("Test wallet: signing is blocked for this run (--allow solana)");
      }
      write({ type: "rail", rail: "solana", action: "signed", what });
      tx.sign([kp]);
      return Buffer.from(tx.serialize()).toString("base64");
    });
    await ctx.addInitScript(({ address, bytes }) => {
      const account = { address, publicKey: new Uint8Array(bytes), chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
      const listeners = new Set();
      const wallet = {
        version: "1.0.0",
        name: "Test Wallet",
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23f0645a'/%3E%3C/svg%3E",
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; listeners.forEach((l) => l({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; listeners.forEach((l) => l({ accounts: [] })); } },
          "standard:events": { version: "1.0.0", on: (_e, l) => (listeners.add(l), () => listeners.delete(l)) },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: (...inputs) =>
              Promise.all(inputs.map(async ({ transaction }) => {
                const signed = await window.__bhSolSign(btoa(String.fromCharCode(...transaction)));
                return { signedTransaction: Uint8Array.from(atob(signed), (c) => c.charCodeAt(0)) };
              })),
          },
        },
      };
      const register = ({ register }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
      try {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
      } catch {}
    }, { address: kp.publicKey.toBase58(), bytes: [...kp.publicKey.toBytes()] });
  }

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
  // progress = the screen changed or a request answered. in-flight requests are kept to name what a stuck step waits on
  let lastProgress = Date.now();
  const inflight = new Map();
  const tracked = (u) => u.pathname.startsWith("/api/") || /hyperliquid|privy|chaindefuser|solana|onrender/.test(u.host);
  const watchPage = (p) => {
    p.on("request", (req) => {
      const u = new URL(req.url());
      if (tracked(u)) inflight.set(req, { m: req.method(), p: `${u.host.includes("localhost") ? "" : u.host}${u.pathname}`, t0: Date.now() });
    });
    p.on("requestfinished", (req) => inflight.delete(req));
    p.on("requestfailed", (req) => inflight.delete(req));
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
  // force: a picture even with screenshots off (a failing step)
  const shot = async (label, p = page, force = false) => {
    if (!shots && !force) return null;
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
        // the open sheet (ours or Privy's), whole: progress lives there
        dialog: [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getBoundingClientRect().height > 0 && getComputedStyle(d.closest('[aria-hidden]') ?? d).opacity !== "0").map((d) => d.textContent?.trim()).join(" | ").slice(0, 600) || null,
      }))
      .catch(() => ({ live: [], toasts: [], dialog: null }));

  // the stuck detector: while a step runs, a heartbeat every 10 s; after `stall` seconds with no progress, one loud
  // STUCK report (what's on screen, what's still loading and for how long, console errors) plus a picture
  let screenText = "";
  // a stuck step ends the run: the report is written, the video finished, the reason printed, and the flow fails
  let stuckError = null;
  const monitor = (label, limit = stall) => {
    const t0 = Date.now();
    lastProgress = Date.now();
    let reported = false;
    const tick = setInterval(async () => {
      const s = await status();
      const text = [...s.live, ...s.toasts, s.dialog ?? ""].join(" | ");
      if (text !== screenText) {
        screenText = text;
        lastProgress = Date.now();
      }
      const idle = Math.round((Date.now() - lastProgress) / 1000);
      const waiting = [...inflight.values()].filter((r) => Date.now() - r.t0 > 5000).map((r) => `${r.m} ${r.p} ${Math.round((Date.now() - r.t0) / 1000)}s`);
      console.log(`  … ${label} ${Math.round((Date.now() - t0) / 1000)}s · idle ${idle}s${waiting.length ? ` · waiting on ${waiting.join(", ")}` : ""} · ${text.slice(0, 90) || "(nothing on screen)"}`);
      if (idle >= limit && !reported) {
        reported = true;
        const f = await shot(`${label}-stuck`, page, true);
        write({ type: "stuck", step: label, idle, screen: text.slice(0, 500), waiting, errors: errors.slice(-5), api: api.slice(-6), shot: f });
        stuckError = `STUCK ${label}: the screen hasn't changed for ${idle}s. screen: ${text.slice(0, 160) || "nothing"}${waiting.length ? ` · still loading: ${waiting.join(", ")}` : " · nothing loading"}${errors.length ? ` · last error: ${errors.at(-1)}` : ""}`;
        console.log(`  ⚠ ${stuckError}`);
      }
    }, 5_000);
    return () => clearInterval(tick);
  };

  const steps = [];
  // one operation: run it, let the UI settle, screenshot, log what it did
  const step = async (name, fn, { settle = 900 } = {}) => {
    api = [];
    errors = [];
    stuckError = null;
    const t0 = Date.now();
    const stop = monitor(name);
    try {
      await Promise.race([
        fn(page),
        new Promise((_, no) => {
          const t = setInterval(() => stuckError && (clearInterval(t), no(new Error(stuckError))), 1000);
        }),
      ]);
      await page.waitForTimeout(settle);
      const f = await shot(name);
      const rec = { type: "step", step: name, ok: true, ms: Date.now() - t0, url: page.url(), shot: f, status: await status(), api, errors };
      write(rec);
      steps.push(rec);
      stop();
    } catch (e) {
      stop();
      const f = await shot(`${name}-error`, page, true);
      const rec = { type: "step", step: name, ok: false, ms: Date.now() - t0, url: page.url(), shot: f, error: String(e.message ?? e).split("\n")[0], status: await status(), api, errors };
      write(rec);
      steps.push(rec);
      throw e;
    }
  };

  // a long step (signing, arming, closing): read the status every second, screenshot each change, stop on done or a failure
  // done(text, page) may be async: check real buttons, not only text
  const watch = async (name, done, { timeout = 120_000, stallAfter = stall } = {}) => {
    const t0 = Date.now();
    let last = "";
    stuckError = null;
    const stop = monitor(name, stallAfter);
    try {
    while (Date.now() - t0 < timeout) {
      const s = await status();
      const text = [...s.live, ...s.toasts, s.dialog ?? ""].join(" | ");
      // Privy's own confirm window (the dashboard can force it): approve it and keep the picture
      const privyOk = page.locator("#privy-modal-content button, [id*='privy'] button").filter({ hasText: /^(Approve|Sign|Confirm|Sign and continue|Continue)$/i });
      if (await privyOk.first().isVisible().catch(() => false)) {
        await page.waitForTimeout(1200); // let the recording show the confirm window before approving it
        await privyOk.first().click().catch(() => {});
        write({ type: "privy", step: name, action: "approved the confirm window" });
      }
      if (text !== last) {
        last = text;
        write({ type: "watch", step: name, text, shot: (await shot(`${name}-watch`)) ?? undefined });
      }
      if (await done(text, page)) return text;
      if (stuckError) throw new Error(stuckError);
      if (/failed|try again|couldn't|can't|refused|cancelled|Nothing was sent/i.test([...s.live, ...s.toasts].join(" ") + " " + (s.dialog?.match(/(Something went wrong[^|]*|You cancelled[^|]*|Refunded[^|]*)/)?.[0] ?? ""))) throw new Error(`${name}: ${text}`);
      await page.waitForTimeout(1000);
    }
    throw new Error(`${name}: timed out after ${timeout / 1000}s (last: ${last || "nothing"})`);
    } finally {
      stop();
    }
  };

  // open every explorer link on screen: hrefs are read all at once first (toasts expire), then each is visited.
  // with video, in the same tab so the recording stays one piece
  const views = async (name, max = 4) => {
    const hrefs = await page
      .evaluate(() => [...new Set([...document.querySelectorAll('.toast-in a, a[aria-label="View transaction"], a[aria-label="View on the Hyperliquid explorer"], [role="dialog"] a[target="_blank"]')].filter((a) => a.getClientRects().length > 0 && !a.closest('[aria-hidden="true"]')).map((a) => a.href).filter(Boolean))])
      .catch(() => []);
    const list = hrefs.slice(0, max);
    for (let i = 0; i < list.length; i++) {
      const href = list[i];
      await step(`${name}-view-${i + 1}`, async () => {
        if (video) {
          const back = page.url();
          await page.goto(href, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(5000);
          write({ type: "view", href, url: page.url(), title: await page.title().catch(() => "") });
          await page.goto(back, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2500);
          return;
        }
        const popup = await ctx.newPage();
        await popup.goto(href, { waitUntil: "domcontentloaded" }).catch(() => {});
        await popup.waitForTimeout(4000);
        write({ type: "view", href, url: popup.url(), title: await popup.title().catch(() => ""), shot: (await shot(`${name}-explorer-${i + 1}`, popup)) ?? undefined });
        await popup.close();
      });
    }
    if (!list.length) write({ type: "view", note: "no View links on screen" });
    return list.length;
  };

  // refuse to run on the wrong account
  const signedIn = async () => {
    await page.waitForFunction((e) => document.body.innerText.includes(e), email, { timeout: 30_000 }).catch(() => {});
    const ok = await page.evaluate((e) => document.body.innerText.includes(e), email);
    write({ type: "account", expected: email, ok });
    if (!ok) throw new Error(`not signed in as ${email}: copy the profile again (--fresh-profile) after signing in on Chrome`);
  };

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const lines = [`# ${name} · ${stamp}`, "", `${url} · signed in as ${email} · allowed: ${allow.join(", ") || "nothing"}`, "", "| | step | s | outcome |", "|---|---|---|---|"];
    for (const s of steps) lines.push(`| ${s.ok ? "✓" : "✗"} | ${s.step} | ${(s.ms / 1000).toFixed(1)} | ${(s.error ?? [...s.status.live, ...s.status.toasts].join(" · ")).replace(/\|/g, "/").slice(0, 140)} |`);
    const raw = video ? await page.video()?.path().catch(() => null) : null;
    await ctx.close().catch(() => {});
    // the recording is complete only once the browser closes: then make an mp4 named after the flow
    if (raw && fs.existsSync(raw)) {
      const mp4 = path.join(dir, `${name}.mp4`);
      try {
        execSync(`ffmpeg -y -loglevel error -i "${raw}" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "${mp4}"`);
        lines.splice(2, 0, `Recording: [${name}.mp4](${name}.mp4)`, "");
        console.log("recording:", mp4);
      } catch {
        console.log("recording (webm):", raw);
      }
    }
    fs.writeFileSync(path.join(dir, "summary.md"), lines.join("\n") + "\n");
    console.log("run folder:", dir);
  };
  // an interrupt (Ctrl-C, a stopped run) still finishes the recording
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => close().finally(() => process.exit(130)));

  return { page, ctx, dir, step, watch, views, shot, status, signedIn, close, log: write };
}
