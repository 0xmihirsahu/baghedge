"use client";

import { ArrowLeft, Backspace, ChartLineUp, ClockCounterClockwise, ShieldCheck, Wallet, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BagLoader, ExposureDots, LogoReveal, NumberRoll, RuleLines, StatusText, TransferTrack } from "@/components/motion";
import { useHyperliquid, type Candle, type Interval } from "./app/hl";
import { short, useWatchedWallet } from "./app/wallet";

// the terminal, laid out like fomo's desktop (via musdy): sidebar, coin page, ticket. one screen.
// real and live: every price, SOL's market, candles, trades, the watched wallet's SOL, leverage and precision.
// replay: signing, funding and the hedge's orders, because the worker and guard aren't connected yet (repo README)
type Phase = "draft" | "signing" | "detected" | "transit" | "credited" | "armed" | "entry" | "open" | "buyback" | "closing" | "closed";
const STATUS: Record<Phase, string> = {
  draft: "Draft", signing: "Awaiting signature", detected: "Deposit detected", transit: "In transit", credited: "Credited",
  armed: "Armed", entry: "Entry pending", open: "Recovery stop active", buyback: "Buyback pending", closing: "Closing", closed: "Closed",
};
const AUTO: Partial<Record<Phase, [Phase, number]>> = {
  signing: ["detected", 1300], detected: ["transit", 1200], transit: ["credited", 2600], entry: ["open", 1400], buyback: ["open", 1600], closing: ["closed", 1500],
};
const FUNDING: Phase[] = ["signing", "detected", "transit", "credited"];
const RANGES: Record<string, [Interval, number]> = { "1H": ["1m", 1], "1D": ["15m", 24], "1W": ["1h", 168], "1M": ["4h", 720] };
const COINS = ["SOL", "BTC", "ETH", "HYPE", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB"];
const LOGO: Record<string, string> = { HYPE: "/tokens/HYPE.jpg", NEAR: "/tokens/NEAR.jpg" };
const logo = (c: string) => LOGO[c] ?? `/tokens/${c}.png`;

const CORAL = "#f0645a";
const UP = "#3ecf8e";
const DOWN = "#f2554b";
const TAKER = 0.00045;
const usd = (n: number, d?: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d ?? (n < 1 ? 4 : 2), maximumFractionDigits: d ?? (n < 1 ? 4 : 2) })}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;

// section 23 of the brief: efficient margin is gap + maintenance × (1 + gap) of notional, plus a buffer, here 5%.
// liquidation for a short is where loss plus maintenance eats the margin
function risk(q: number, entry: number, recovery: number, maxLev: number) {
  const mm = 1 / (2 * maxLev), gap = recovery / entry - 1, notional = q * entry;
  const margin = notional * (gap + mm * (1 + gap) + 0.05);
  const liq = q > 0 ? (margin / q + entry) / (1 + mm) : 0;
  const fees = notional * TAKER * 2 + 1;
  return { margin, liq, fees, notional };
}

type Toasty = { id: number; title: string; status: string };

export function Lab() {
  const [splash, setSplash] = useState(true);
  const [mode, setMode] = useState<"Hedge" | "Trade">("Hedge");
  const [range, setRange] = useState("1D");
  const hl = useHyperliquid(...RANGES[range]);
  const wallet = useWatchedWallet();
  const [phase, setPhase] = useState<Phase>("draft");
  const [review, setReview] = useState(false);
  const [tab, setTab] = useState<"Trades" | "Position" | "Activity">("Trades");
  const [hedge, setHedge] = useState(0);
  const [cap, setCap] = useState("0");
  const [entry, setEntry] = useState(0);
  const [recovery, setRecovery] = useState(0);
  const [toasts, setToasts] = useState<Toasty[]>([]);
  const [activity, setActivity] = useState<{ at: number; what: string }[]>([]);
  const [sheet, setSheet] = useState(false);
  const mark = hl.sol?.mark;
  const held = wallet.sol ?? 0;

  const toast = useCallback((title: string, status: string) => {
    const id = Math.random();
    setToasts((v) => [...v.slice(-2), { id, title, status }]);
    setActivity((v) => [{ at: Date.now(), what: `Replay · ${title} ${status.toLowerCase()}` }, ...v]);
    setTimeout(() => setToasts((v) => v.filter((x) => x.id !== id)), 3200);
  }, []);

  // starting prices from the live mark, and a starting cap of half the wallet once it's read
  useEffect(() => {
    if (!mark || entry) return;
    const t = setTimeout(() => {
      setEntry(Math.round(mark * 0.97 * 100) / 100);
      setRecovery(Math.round(mark * 1.03 * 100) / 100);
    }, 0);
    return () => clearTimeout(t);
  }, [mark, entry]);
  useEffect(() => {
    if (wallet.sol === null || cap !== "0") return;
    const t = setTimeout(() => setCap(String(Math.floor((wallet.sol! / 2) * 100) / 100)), 0);
    return () => clearTimeout(t);
  }, [wallet.sol, cap]);

  const capN = Math.min(Number(cap) || 0, held);

  // replay steps that move on by themselves
  useEffect(() => {
    const next = AUTO[phase];
    if (!next) return;
    const t = setTimeout(() => {
      if (phase === "entry") { setHedge(-capN); toast("Short", "Filled"); }
      if (phase === "buyback") { setHedge(-held); toast("Buyback", "Filled"); }
      if (phase === "closing") { setHedge(0); toast("Hedge", "Closed"); }
      if (phase === "transit") toast("Deposit", "Credited");
      setPhase(next[0]);
    }, next[1]);
    return () => clearTimeout(t);
  }, [phase, capN, held, toast]);

  // the live mark drives the rule: a real crossing down through the entry, or up to the recovery
  useEffect(() => {
    if (!mark) return;
    const t = setTimeout(() => {
      if (phase === "armed" && mark <= entry) setPhase("entry");
      if (phase === "open" && mark >= recovery) setPhase("closing");
    }, 0);
    return () => clearTimeout(t);
  }, [mark, phase, entry, recovery]);

  // the real wallet drives resizing: if the watched SOL drops below the short, buy back the excess
  useEffect(() => {
    if (phase !== "open" || !wallet.sol || -hedge <= wallet.sol + 1e-9) return;
    const t = setTimeout(() => setPhase("buyback"), 0);
    return () => clearTimeout(t);
  }, [wallet.sol, hedge, phase]);

  if (splash)
    return (
      <main className="grid h-svh place-items-center bg-[#0b0908]">
        <LogoReveal size={120} onDone={() => setTimeout(() => setSplash(false), 500)} />
      </main>
    );

  const step = FUNDING.indexOf(phase);
  const armed = !["draft", ...FUNDING, "closed"].includes(phase);
  const change = hl.sol ? hl.sol.mark / hl.sol.prevDay - 1 : 0;

  const ticket = (
    <Ticket
      mode={mode}
      setMode={setMode}
      mark={mark}
      change={change}
      maxLev={hl.sol?.maxLeverage ?? 20}
      phase={phase}
      step={step}
      wallet={wallet}
      held={held}
      hedge={hedge}
      cap={cap}
      setCap={setCap}
      capN={capN}
      entry={entry}
      recovery={recovery}
      onAction={() => {
        if (phase === "draft") setReview(true);
        else if (phase === "credited") setPhase("armed");
        else if (phase === "armed") setPhase("entry");
        else if (phase === "open") setPhase("closing");
        else if (phase === "closed") setPhase("draft");
      }}
      onTrade={(side) => toast(`${side} SOL`, "Checking order")}
    />
  );

  return (
    <main className="grid h-svh overflow-hidden bg-[#0b0908] lg:grid-cols-[240px_minmax(0,1fr)_380px]">
      {/* sidebar: nav, live markets, the watched wallet */}
      <aside className="hidden min-h-0 flex-col border-r border-white/[0.08] lg:flex">
        <div className="px-4 pb-4 pt-5">
          <div className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mascot.webp" alt="" className="size-6" />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">baghedge</span>
            <span className={`ml-auto text-[12px] ${hl.live ? "text-white/50" : "text-[#f2554b]"}`}>{hl.live ? "Live" : "Offline"}</span>
          </div>
          <nav className="mt-6 flex flex-col gap-1 text-[15px] font-medium">
            {[
              { label: "Markets", icon: ChartLineUp },
              { label: "Hedge", icon: ShieldCheck, on: true },
              { label: "Portfolio", icon: Wallet },
              { label: "Activity", icon: ClockCounterClockwise },
            ].map((n) => (
              <span key={n.label} className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 ${n.on ? "bg-[#1c1b1a] text-white" : "text-white/55"}`}>
                <n.icon size={20} weight={n.on ? "fill" : "regular"} />
                {n.label}
              </span>
            ))}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-y border-white/[0.08] px-4 py-2">
          {COINS.map((c) => {
            const px = hl.mids[c], prev = hl.prevDay[c];
            const ch = px && prev ? px / prev - 1 : undefined;
            return (
              <div key={c} className={`flex items-center gap-3 rounded-[12px] px-2.5 py-2.5 ${c === "SOL" ? "bg-[#1c1b1a]" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo(c)} alt="" className="size-8 rounded-full" />
                <span className="text-[15px] font-semibold">{c}</span>
                <span className="ml-auto text-right leading-tight tabular-nums">
                  <span className="block text-[14px] font-medium">{px ? usd(px) : "…"}</span>
                  <span className="block text-[12px]" style={{ color: ch === undefined ? undefined : ch < 0 ? DOWN : UP }}>{ch === undefined ? "" : pct(ch)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <WalletBox wallet={wallet} />
      </aside>

      {/* coin page: price, chart, live lists */}
      <section className="flex min-h-0 flex-col pb-[72px] lg:pb-0">
        <header className="flex items-start justify-between px-5 pb-1 pt-5 sm:px-7">
          <div>
            <div className="flex items-center gap-3">
              <ArrowLeft size={20} className="text-white/55" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/tokens/SOL.png" alt="" className="size-8 rounded-full" />
              <span className="text-[18px] font-semibold">SOL</span>
              <span className="rounded-[7px] bg-[#1c1b1a] px-2 py-0.5 text-[12px] text-white/60">{hl.sol ? `${hl.sol.maxLeverage}x` : ""}</span>
            </div>
            <div className="mt-3 text-[42px] font-semibold leading-none tracking-[-0.03em] sm:text-[48px]">
              {mark ? <NumberRoll value={mark} format={(n) => usd(n)} /> : <BagLoader size={34} label="Loading SOL" />}
            </div>
            {hl.sol && <p className="mt-2 text-[14px] font-medium" style={{ color: change < 0 ? DOWN : UP }}>{pct(change)} <span className="font-normal text-white/45">24h</span></p>}
          </div>
          {hl.sol && (
            <div className="hidden gap-8 text-right sm:flex">
              <Stat label="Funding" value={`${(hl.sol.funding * 100).toFixed(4)}%`} />
              <Stat label="Open interest" value={`$${((hl.sol.oi * hl.sol.mark) / 1e6).toFixed(0)}M`} />
            </div>
          )}
        </header>

        <div className="relative min-h-[220px] flex-1">
          {hl.candles.length > 1 ? (
            <Chart
              candles={hl.candles}
              mark={mark ?? hl.candles.at(-1)!.c}
              entry={entry}
              recovery={recovery}
              show={mode === "Hedge" && entry > 0}
              editing={mode === "Hedge" && phase === "draft"}
              armed={mode === "Hedge" && armed}
              onEntry={setEntry}
              onRecovery={setRecovery}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center"><BagLoader size={48} label="Loading candles" /></div>
          )}
        </div>

        <div className="flex gap-1 px-5 py-2.5 sm:px-7">
          {Object.keys(RANGES).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded-[10px] px-3.5 py-2 text-[13px] font-medium ${r === range ? "bg-[#1c1b1a] text-white" : "text-white/45 hover:text-white"}`}>
              {r}
            </button>
          ))}
        </div>

        <div className="flex h-[210px] shrink-0 flex-col border-t border-white/[0.08] lg:h-[240px]">
          <div className="flex gap-7 border-b border-white/[0.08] px-5 sm:px-7">
            {(["Trades", "Position", "Activity"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`relative py-3.5 text-[15px] font-medium ${t === tab ? "text-white" : "text-white/45"}`}>
                {t}
                {t === tab && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#f0645a]" />}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-7">
            {tab === "Trades" &&
              (hl.trades.length ? (
                hl.trades.map((t) => (
                  <div key={t.tid} className="grid grid-cols-[1fr_1fr_1fr_1fr] py-2 text-[14px] tabular-nums">
                    <span className="text-white/45">{new Date(t.time).toLocaleTimeString("en-GB")}</span>
                    <span className="font-medium" style={{ color: t.side === "B" ? UP : DOWN }}>{t.side === "B" ? "Buy" : "Sell"}</span>
                    <span className="text-right">{usd(t.px)}</span>
                    <span className="text-right text-white/70">{t.sz.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL</span>
                  </div>
                ))
              ) : (
                <div className="grid h-full place-items-center"><BagLoader size={28} label="Loading trades" /></div>
              ))}
            {tab === "Position" &&
              (hedge ? (
                <div className="flex items-center gap-3 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/tokens/SOL.png" alt="" className="size-9 rounded-full" />
                  <div className="leading-tight">
                    <p className="text-[15px] font-semibold">Short <span className="font-normal text-white/45">Replay · Hedge account</span></p>
                    <StatusText text={STATUS[phase]} className="text-[13px] text-white/55" />
                  </div>
                  <div className="ml-auto text-right leading-tight tabular-nums">
                    <NumberRoll value={hedge} format={(n) => `${n.toFixed(2)} SOL`} className="text-[15px] font-semibold" />
                    <p className="text-[13px] text-white/45">{mark ? usd(Math.abs(hedge) * mark) : ""}</p>
                  </div>
                </div>
              ) : (
                <p className="py-6 text-center text-[14px] text-white/45">No position</p>
              ))}
            {tab === "Activity" &&
              (activity.length ? (
                activity.map((a, i) => (
                  <div key={i} className="flex gap-4 py-2.5 text-[14px]">
                    <span className="text-white/45 tabular-nums">{new Date(a.at).toLocaleTimeString("en-GB")}</span>
                    <span>{a.what}</span>
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-[14px] text-white/45">No activity</p>
              ))}
          </div>
        </div>
      </section>

      {/* ticket: a column on desktop, a bottom sheet on a phone */}
      <aside className="hidden min-h-0 flex-col border-l border-white/[0.08] lg:flex">{ticket}</aside>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#0b0908] p-3 lg:hidden">
        <button onClick={() => setSheet(true)} className="h-12 w-full rounded-[14px] bg-[#f0645a] text-[16px] font-semibold">
          {mode === "Hedge" ? (phase === "draft" ? "Hedge SOL" : STATUS[phase]) : "Trade SOL"}
        </button>
      </div>
      <div className={`fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden ${sheet ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setSheet(false)}>
        <div className={`absolute inset-x-0 bottom-0 flex h-[90svh] flex-col rounded-t-[24px] bg-[#0b0908] transition-transform duration-300 ${sheet ? "translate-y-0" : "translate-y-full"}`} onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-white/20" />
          {!wallet.address && <WalletBox wallet={wallet} />}
          {ticket}
        </div>
      </div>

      {/* review before anything is signed */}
      <div className={`fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 transition-opacity ${review ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setReview(false)}>
        <div className={`w-full max-w-[400px] rounded-[24px] bg-[#141312] p-6 transition-transform duration-300 ${review ? "scale-100" : "scale-95"}`} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <p className="text-[18px] font-semibold">Review</p>
            <button onClick={() => setReview(false)} className="text-white/50 hover:text-white" aria-label="Close"><X size={20} /></button>
          </div>
          {(() => {
            const r = risk(capN, entry, recovery, hl.sol?.maxLeverage ?? 20);
            return (
              <>
                <p className="mt-6 text-[44px] font-semibold leading-none tracking-[-0.03em]">{capN} SOL</p>
                <div className="mt-6 divide-y divide-white/[0.08] text-[14px]">
                  {[
                    ["Entry", usd(entry)],
                    ["Recovery", usd(recovery)],
                    ["Margin, est.", usd(r.margin)],
                    ["Liquidation, est.", usd(r.liq)],
                    ["Fees, est.", usd(r.fees)],
                    ["Runs", "Once, 7 days"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-3"><span className="text-white/50">{k}</span><span className="font-medium tabular-nums">{v}</span></div>
                  ))}
                </div>
              </>
            );
          })()}
          <button onClick={() => { setReview(false); setSheet(false); setPhase("signing"); }} className="mt-6 h-[52px] w-full rounded-[14px] bg-[#f0645a] text-[16px] font-semibold">
            Sign and fund
          </button>
          <p className="mt-3 text-center text-[12px] text-white/40">Replay. Nothing is signed.</p>
        </div>
      </div>

      <div className="fixed right-4 top-4 z-40 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex w-[240px] items-center gap-3 rounded-[14px] bg-[#1c1b1a] px-4 py-3">
            <span className="text-[13px] text-white/50">Replay · {t.title}</span>
            <StatusText text={t.status} className="text-[15px] font-medium" />
          </div>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <p className="text-[15px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[12px] text-white/45">{label}</p>
    </div>
  );
}

// connect phantom or paste an address. we read the public balance, nothing else
function WalletBox({ wallet }: { wallet: ReturnType<typeof useWatchedWallet> }) {
  const [addr, setAddr] = useState("");
  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {wallet.address ? (
        <div className="flex items-center gap-3 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/phantom.svg" alt="" className="size-9 rounded-[10px] bg-[#ab9ff2] p-1.5" />
          <div className="min-w-0 whitespace-nowrap text-[14px] leading-tight">
            <p className="font-semibold tabular-nums">{wallet.sol === null ? "…" : <NumberRoll value={wallet.sol} format={(n) => `${n.toFixed(2)} SOL`} />}</p>
            <p className="text-white/45">{short(wallet.address)}</p>
          </div>
          <button onClick={wallet.forget} className="ml-auto text-white/40 hover:text-white" aria-label="Disconnect"><X size={16} /></button>
        </div>
      ) : (
        <>
          <button onClick={wallet.connect} className="h-11 rounded-[12px] bg-[#f0645a] text-[15px] font-semibold">Connect Phantom</button>
          <form onSubmit={(e) => { e.preventDefault(); wallet.watch(addr); }}>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Or paste a Solana address" className="h-10 w-full rounded-[11px] bg-[#1c1b1a] px-3 text-[13px] outline-none placeholder:text-white/35" />
          </form>
          {wallet.error && <p className="text-[12px]" style={{ color: DOWN }}>{wallet.error}</p>}
        </>
      )}
    </div>
  );
}

// fomo's buy panel, worn for the hedge: coin row, big amount, chips, pad, summary, button, stats
function Ticket(p: {
  mode: "Hedge" | "Trade";
  setMode: (m: "Hedge" | "Trade") => void;
  mark?: number;
  change: number;
  maxLev: number;
  phase: Phase;
  step: number;
  wallet: ReturnType<typeof useWatchedWallet>;
  held: number;
  hedge: number;
  cap: string;
  setCap: (v: string) => void;
  capN: number;
  entry: number;
  recovery: number;
  onAction: () => void;
  onTrade: (side: "Long" | "Short") => void;
}) {
  const [usdIn, setUsdIn] = useState("100");
  const [side, setSide] = useState<"Long" | "Short">("Long");
  const hedgeMode = p.mode === "Hedge";
  const draft = p.phase === "draft";
  const connected = !!p.wallet.address;
  const editable = !hedgeMode || draft;
  const value = hedgeMode ? p.cap : usdIn;
  const setValue = hedgeMode ? p.setCap : setUsdIn;
  const key = (k: string) => {
    if (!editable) return;
    if (k === "back") return setValue(value.slice(0, -1) || "0");
    if (k === "." && value.includes(".")) return;
    if (k !== "." && /\.\d{2}$/.test(value)) return;
    setValue(value === "0" && k !== "." ? k : value + k);
  };
  const busy = hedgeMode && !!AUTO[p.phase];
  const over = hedgeMode && (Number(p.cap) || 0) > p.held + 1e-9;
  const label = hedgeMode
    ? !connected
      ? "Connect Phantom"
      : ({ draft: "Review hedge", credited: "Arm", armed: "Simulate a crossing", open: "Close hedge", closed: "New hedge" } as Partial<Record<Phase, string>>)[p.phase]
    : `${side} SOL`;
  const disabled = hedgeMode && connected && (!label || busy || over || p.recovery <= p.entry || p.capN <= 0);
  const press = () => (hedgeMode ? (connected ? p.onAction() : p.wallet.connect()) : p.onTrade(side));
  const r = risk(p.capN, p.entry, p.recovery, p.maxLev);
  const tradeQ = p.mark ? (Number(usdIn) || 0) / p.mark : 0;

  // the keyboard works like the pad. only the ticket on screen listens (it's mounted twice)
  const keys = useRef({ key, enter: () => {} });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keys.current = { key, enter: () => !disabled && press() };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!root.current || root.current.offsetParent === null) return;
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) || e.key === ".") keys.current.key(e.key);
      else if (e.key === "Backspace") keys.current.key("back");
      else if (e.key === "Enter") keys.current.enter();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[#1c1b1a] p-1">
        {(["Hedge", "Trade"] as const).map((m) => (
          <button key={m} onClick={() => p.setMode(m)} className={`h-10 rounded-[11px] text-[15px] font-semibold ${p.mode === m ? "bg-[#2e2c2a] text-white" : "text-white/45"}`}>
            {m}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tokens/SOL.png" alt="" className="size-10 rounded-full" />
        <div className="leading-tight">
          <p className="text-[16px] font-semibold">SOL</p>
          <p className="text-[13px] text-white/45">{hedgeMode ? (connected ? `${p.held.toFixed(2)} in wallet` : "No wallet") : "Trade account"}</p>
        </div>
        <div className="ml-auto text-right leading-tight tabular-nums">
          <p className="text-[15px] font-semibold">{p.mark ? usd(p.mark) : "…"}</p>
          <p className="text-[13px]" style={{ color: p.change < 0 ? DOWN : UP }}>{pct(p.change)}</p>
        </div>
      </div>

      {!hedgeMode && (
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-[12px] bg-[#1c1b1a] p-1">
          {(["Long", "Short"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={`h-9 rounded-[9px] text-[14px] font-semibold ${side === s ? "text-[#0b0908]" : "text-white/45"}`} style={{ background: side === s ? (s === "Short" ? DOWN : UP) : undefined, transition: "background-color 200ms ease" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="whitespace-nowrap font-semibold leading-none tracking-[-0.03em] tabular-nums" style={{ color: over ? DOWN : undefined, fontSize: Math.max(26, 52 - Math.max(0, value.length - 6) * 4) }}>
          {hedgeMode ? `${value} SOL` : `$${value}`}
        </p>
        <p className="mt-2 text-[14px] text-white/45 tabular-nums">
          {p.mark ? (hedgeMode ? usd(p.capN * p.mark) : `${tradeQ.toFixed(3)} SOL`) : " "}
        </p>
      </div>

      {hedgeMode && p.step >= 0 ? (
        <TransferTrack step={p.step} amount={`${Math.ceil(r.margin)} USDC`} className="mt-6" />
      ) : hedgeMode && !draft ? (
        <div className="mt-6 flex justify-center"><ExposureDots watched={p.held} hedged={p.hedge} per={Math.max(0.5, p.held / 16)} size={12} /></div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {(hedgeMode ? ["25%", "50%", "75%", "Max"] : ["$10", "$50", "$100", "$250"]).map((c) => (
              <button
                key={c}
                disabled={hedgeMode && !connected}
                onClick={() => (hedgeMode ? p.setCap(String(Math.floor(p.held * (c === "Max" ? 100 : parseInt(c)))/ 100)) : setUsdIn(c.slice(1)))}
                className="h-10 rounded-[11px] bg-[#1c1b1a] text-[14px] font-semibold hover:bg-[#2e2c2a] disabled:opacity-40"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
              <button key={k} onClick={() => key(k)} className="flex h-12 items-center justify-center rounded-[12px] text-[20px] font-medium hover:bg-[#1c1b1a]" aria-label={k === "back" ? "Delete" : k}>
                {k === "back" ? <Backspace size={22} /> : k}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-3 text-right text-[13px] text-white/45 tabular-nums">
        {hedgeMode ? (
          <>
            <span style={{ color: CORAL }}>Entry {usd(p.entry)}</span> · Recovery {usd(p.recovery)}
          </>
        ) : (
          `Fee ${usd((Number(usdIn) || 0) * TAKER, 2)}`
        )}
      </p>

      <button disabled={disabled} onClick={press} className="mt-3 flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[#f0645a] text-[16px] font-semibold disabled:bg-[#1c1b1a] disabled:text-white/60">
        {busy && <BagLoader size={18} color="#f0645a" glyph="#ffffff" label={STATUS[p.phase]} />}
        {over ? "More than you hold" : label ?? STATUS[p.phase]}
      </button>
      {hedgeMode && !draft && <StatusText text={`Replay · ${STATUS[p.phase]}`} className="mt-2 block text-center text-[13px] text-white/55" />}

      <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.08] pt-4">
        {(hedgeMode
          ? [
              ["Margin, est.", p.capN ? usd(r.margin) : "—"],
              ["Liquidation, est.", p.capN ? usd(r.liq) : "—"],
              ["Fees, est.", p.capN ? usd(r.fees) : "—"],
              ["Max leverage", `${p.maxLev}x`],
            ]
          : [
              ["Notional", usd(Number(usdIn) || 0)],
              ["Size", `${tradeQ.toFixed(3)} SOL`],
              ["Taker fee", "0.045%"],
              ["Max leverage", `${p.maxLev}x`],
            ]
        ).map(([k, v]) => (
          <div key={k} className="leading-tight">
            <p className="text-[12px] text-white/45">{k}</p>
            <p className="mt-1 text-[15px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// a solid price line with a soft fill on fomo's dotted grid, the live mark as a dashed line,
// and the rule lines from the kit at the same scale. while drafting, the lines drag
function Chart(p: { candles: Candle[]; mark: number; entry: number; recovery: number; show: boolean; editing: boolean; armed: boolean; onEntry: (v: number) => void; onRecovery: (v: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const closes = p.candles.map((c) => c.c);
  const { lo, hi } = useMemo(() => {
    const min = Math.min(...closes), max = Math.max(...closes), pad = (max - min) * 0.4 + max * 0.006;
    return { lo: min - pad, hi: max + pad };
    // the range only moves when the candle set changes, so dragging a line never rescales under the pointer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.candles.length, p.candles[0]?.t]);
  const top = 14, bot = size.h - 14, right = size.w - 64;
  const yOf = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
  const vOf = (y: number) => Math.round((lo + (1 - (y - top) / (bot - top)) * (hi - lo)) * 100) / 100;
  const pts = closes.map((v, i) => [(i / (closes.length - 1)) * right, yOf(v)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const trend = p.mark >= closes[0] ? UP : DOWN;
  const my = yOf(p.mark);

  return (
    <div ref={box} className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, rgb(255 255 255 / 0.06) 1px, transparent 1.4px)", backgroundSize: "14px 14px" }}>
      {size.w > 0 && (
        <>
          <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden>
            <defs>
              <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={trend} stopOpacity="0.22" />
                <stop offset="1" stopColor={trend} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${right} ${size.h} L0 ${size.h} Z`} fill="url(#fill)" />
            <path d={line} fill="none" stroke={trend} strokeWidth={2} strokeLinejoin="round" />
            <line x1={0} x2={size.w} y1={my} y2={my} stroke={trend} strokeOpacity={0.6} strokeDasharray="2 4" />
            <circle cx={right} cy={my} r={4} fill={trend} />
          </svg>
          <span className="absolute right-2 -translate-y-1/2 rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-[#0b0908]" style={{ top: my, background: trend }}>
            {p.mark.toFixed(2)}
          </span>
          {p.show && (
            <RuleLines
              variant="line"
              armed={p.armed}
              editing={p.editing}
              recovery={{ y: yOf(p.recovery), label: `Recovery ${usd(p.recovery)}`, onDrag: (y) => p.onRecovery(vOf(y)) }}
              entry={{ y: yOf(p.entry), label: `Entry ${usd(p.entry)}`, onDrag: (y) => p.onEntry(vOf(y)) }}
            />
          )}
        </>
      )}
    </div>
  );
}
