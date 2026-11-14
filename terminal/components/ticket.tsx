"use client";

import { Backspace } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BagLoader, ExposureDots, StatusText, TransferTrack } from "@/components/motion";
import { CoinLogo } from "./coin-logo";
import { Tip } from "./tip";
import { AUTO, FUNDING, STATUS, useStore, type Phase } from "./app/store";
import { ruleLabel } from "./app/live";
import { CORAL, DOWN, INK, TAKER, UP, pct, risk, usd } from "./app/format";

// fomo's buy panel: coin row, big amount, chips, pad, summary, action, estimates.
// Hedge (SOL only) sizes against the watched wallet; Trade sizes a market order in dollars
export function Ticket({ coin, mark, change, maxLev, onReview }: { coin: string; mark?: number; change: number; maxLev: number; onReview: () => void }) {
  const { wallet, hedge: h, toast, liveEnabled, liveHedge, backend, privy, liveCapable } = useStore();
  const canHedge = coin === "SOL";
  const [modeState, setMode] = useState<"Hedge" | "Trade">("Hedge");
  const mode = canHedge ? modeState : "Trade";
  const hedgeMode = mode === "Hedge";
  const [usdIn, setUsdIn] = useState("100");
  const [lev, setLev] = useState(5);
  const leverage = Math.min(lev, maxLev);
  // live: the backend's rule drives the ticket; replay: the local phases do
  const L = liveEnabled ? liveHedge : null;
  const ruleOn = !!L?.rule && L.rule.status === "active";
  const net = backend.mode === "testnet" ? "Testnet" : "Mainnet";
  const draft = L ? !ruleOn : h.phase === "draft";
  const connected = !!wallet.address;
  const editable = !hedgeMode || draft;
  const value = hedgeMode ? h.cap : usdIn;
  const setValue = hedgeMode ? h.setCap : setUsdIn;
  const key = (k: string) => {
    if (!editable) return;
    if (k === "back") return setValue(value.slice(0, -1) || "0");
    if (k === "." && value.includes(".")) return;
    if (k !== "." && /\.\d{2}$/.test(value)) return;
    setValue(value === "0" && k !== "." ? k : value + k);
  };

  const step = L ? -1 : FUNDING.indexOf(h.phase);
  const busy = hedgeMode && (L ? !!L.busy : !!AUTO[h.phase]);
  const BUSY = { signin: "Sign in in your wallet", approve: "Approve the hedge agent", draft: "Drafting your hedge", arm: "Sign the policy", close: "Sign to close" } as const;
  const over = hedgeMode && (Number(h.cap) || 0) > h.held + 1e-9;
  // with Privy, the real hedge starts with one sign-in that brings the Trade and Hedge accounts
  const signInFirst = connected && hedgeMode && !L && !!privy && liveCapable;
  const label = !connected
    ? privy && !privy.authenticated
      ? "Sign in"
      : privy
        ? "Add your SOL"
        : "Connect wallet"
    : signInFirst
      ? !privy.ready
        ? "Loading"
        : privy.error
          ? "Retry account setup"
          : privy.creating || (privy.authenticated && !privy.hedge)
          ? "Setting up your accounts"
          : "Sign in to hedge"
    : L
      ? L.busy
        ? BUSY[L.busy]
        : ruleOn
          ? L.rule!.phase === "armed"
            ? "Disarm"
            : "Close hedge"
          : "Review hedge"
      : ({ draft: "Review hedge", credited: "Arm", armed: "Simulate a crossing", open: "Close hedge", closed: "New hedge" } as Partial<Record<Phase, string>>)[h.phase];
  const MIN = 10;
  const belowMin = hedgeMode && !!mark && h.capN > 0 && h.capN * mark < MIN;
  const why = !connected || !draft || signInFirst ? null : h.capN <= 0 ? "Enter an amount" : over ? "More than you hold" : belowMin ? `Below the $${MIN} minimum` : h.recovery <= h.entry ? "Recovery must sit above entry" : null;
  const disabled = connected && (!label || busy || !!why || (signInFirst && !privy.error && (!privy.ready || privy.creating || privy.authenticated)));
  const tradeBelowMin = !hedgeMode && (Number(usdIn) || 0) < MIN;
  const act = () => {
    if (!connected) return wallet.connect();
    if (signInFirst) return privy.error ? privy.retry() : privy.login();
    if (L) {
      if (ruleOn) return L.close();
      return L.prepare({ cap: h.capN, entry: h.entry, recovery: h.recovery }).then((d) => d && onReview());
    }
    if (h.phase === "draft") onReview();
    else if (h.phase === "credited") h.setPhase("armed");
    else if (h.phase === "armed") h.setPhase("entry");
    else if (h.phase === "open") h.setPhase("closing");
    else if (h.phase === "closed") h.setPhase("draft");
  };
  const trade = (side: "Long" | "Short") => toast(`${side} ${coin}`, "Checking order");
  const r = risk(h.capN, h.entry, h.recovery, maxLev);
  const tradeQ = mark ? (Number(usdIn) || 0) / mark : 0;

  // the keyboard works like the pad; enter presses the hedge button. only the ticket on screen listens
  const keys = useRef({ key, enter: () => {} });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keys.current = { key, enter: () => hedgeMode && !disabled && act() };
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
      {canHedge && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-[14px] bg-[#1c1b1a] p-1">
          {(["Hedge", "Trade"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`h-10 rounded-[11px] text-[15px] font-semibold transition-colors duration-150 ${mode === m ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/70"}`}>
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <CoinLogo coin={coin} className="size-10" />
        <div className="leading-tight">
          <p className="text-[16px] font-semibold">{coin}</p>
          <p className="text-[13px] text-white/45">
            {hedgeMode ? (
              connected ? <Tip text="Hedge shorts SOL to offset the SOL in your wallet." align="start">{`${h.held.toFixed(2)} in wallet`}</Tip> : "Not connected"
            ) : (
              <Tip text={`Trade places a plain long or short, up to ${maxLev}x.`} align="start">{`Up to ${maxLev}x`}</Tip>
            )}
          </p>
        </div>
        <div className="ml-auto text-right leading-tight tabular-nums">
          <p className="text-[15px] font-semibold">{mark ? usd(mark) : "…"}</p>
          <p className="text-[13px]" style={{ color: change < 0 ? DOWN : UP }}>{pct(change)}</p>
        </div>
      </div>

      <div className="mt-5 flex h-[92px] shrink-0 flex-col items-center justify-center text-center">
        <p className="whitespace-nowrap font-semibold leading-none tracking-[-0.03em] tabular-nums" style={{ color: over ? DOWN : undefined, fontSize: Math.max(26, 52 - Math.max(0, value.length - 6) * 4) }}>
          {hedgeMode ? `${value} SOL` : `$${value}`}
        </p>
        <p className="mt-2 text-[14px] text-white/45 tabular-nums">
          {!mark ? " " : hedgeMode ? (
            <>
              {usd(h.capN * mark)}
              {connected && h.held > 0 && (
                <>
                  {" · "}
                  <Tip text="Share of your wallet's SOL this hedge would short.">
                    covers <span className="text-white">{Math.min(999, Math.round(((Number(h.cap) || 0) / h.held) * 100))}%</span>
                  </Tip>
                </>
              )}
            </>
          ) : (
            `${tradeQ.toFixed(3)} ${coin}`
          )}
        </p>
      </div>

      {hedgeMode && step >= 0 ? (
        <TransferTrack step={step} amount={`${Math.ceil(r.margin)} USDC`} className="mt-6" />
      ) : hedgeMode && !draft ? (
        <div className="mt-6 flex justify-center">
          <ExposureDots watched={h.held} hedged={h.hedge} per={h.held / 20 || 1} size={14} className="w-[203px]" />
        </div>
      ) : (
        <div className="mt-4 shrink-0">
          <div className="grid grid-cols-4 gap-2">
            {(hedgeMode ? ["25%", "50%", "75%", "Max"] : ["$10", "$50", "$100", "$250"]).map((c) => (
              <button
                key={c}
                disabled={hedgeMode && !connected}
                onClick={() => (hedgeMode ? h.setCap(String(Math.floor(h.held * (c === "Max" ? 100 : parseInt(c))) / 100)) : setUsdIn(c.slice(1)))}
                className="h-10 rounded-[11px] bg-[#1c1b1a] text-[14px] font-semibold transition-colors duration-150 hover:bg-[#2e2c2a] active:scale-[0.97] disabled:opacity-40"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
              <button key={k} onClick={() => key(k)} className="flex h-14 items-center justify-center rounded-[12px] text-[22px] font-medium transition-colors duration-100 hover:bg-[#1c1b1a] active:bg-[#2e2c2a]" aria-label={k === "back" ? "Delete" : k}>
                {k === "back" ? <Backspace size={22} /> : k}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col justify-center py-4">
        {hedgeMode ? (
          <RuleTrack mark={mark} entry={h.entry} recovery={h.recovery} />
        ) : (
          <>
            <Leverage value={leverage} max={maxLev} onChange={setLev} />
            {tradeBelowMin && (
              <p className="mt-3 text-center text-[13px] text-[#f2554b]">
                <Tip text={`Hyperliquid rejects orders under $${MIN}.`}>{`Minimum $${MIN}`}</Tip>
              </p>
            )}
          </>
        )}
      </div>

      {hedgeMode ? (
        <button disabled={disabled} onClick={act} className="mt-3 flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[#f0645a] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:bg-[#1c1b1a] disabled:text-white/60">
          {busy && <BagLoader size={18} color={CORAL} glyph="#ffffff" label={STATUS[h.phase]} />}
          {why ?? label ?? STATUS[h.phase]}
        </button>
      ) : (
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
          {(["Long", "Short"] as const).map((s) => (
            <button key={s} disabled={tradeBelowMin} onClick={() => trade(s)} className="h-[52px] rounded-[14px] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:opacity-40" style={{ background: s === "Long" ? UP : DOWN, color: INK }}>
              {s}
            </button>
          ))}
        </div>
      )}
      {hedgeMode && !draft && !L && <StatusText text={`Replay · ${STATUS[h.phase]}`} className="mt-2 block text-center text-[13px] text-white/55" />}
      {hedgeMode && L && ruleOn && <StatusText text={`${net} · ${ruleLabel(L.rule!)}`} className="mt-2 block text-center text-[13px] text-white/55" />}
      {hedgeMode && L && (
        <p aria-live="polite" className="mt-2 min-h-[18px] text-center text-[12px] leading-snug text-[#f2554b]">
          {L.error?.message ?? ""}
        </p>
      )}

      {(!hedgeMode || h.capN > 0) && (
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.08] pt-4">
          {(hedgeMode
            ? [
                ["Margin, est.", usd(r.margin)],
                ["Liquidation, est.", usd(r.liq)],
                ["Fees, est.", usd(r.fees)],
                ["Max leverage", `${maxLev}x`],
              ]
            : [
                ["Notional", usd(Number(usdIn) || 0)],
                ["Size", `${tradeQ.toFixed(3)} ${coin}`],
                ["Margin", usd((Number(usdIn) || 0) / leverage, 2)],
                ["Fee", usd((Number(usdIn) || 0) * TAKER, 2)],
              ]
          ).map(([k, v], i) => (
            <div key={k} className="leading-tight">
              <p className="text-[12px] text-white/45">{TIPS[k] ? <Tip text={TIPS[k].replace("COIN", coin)} align={i % 2 ? "center" : "start"}>{k}</Tip> : k}</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// one short line per estimate label. COIN is swapped for the market
const TIPS: Record<string, string> = {
  "Margin, est.": "USDC the hedge account needs to hold the short.",
  "Liquidation, est.": "Price where the venue would close the short.",
  "Fees, est.": "Taker fees to open and close the short.",
  "Max leverage": "The most leverage Hyperliquid allows on this market.",
  Notional: "Total dollar value of the order.",
  Size: "How much COIN the order buys or sells.",
  Fee: "Taker fee, 0.045% of the order.",
  Margin: "USDC this order ties up at the chosen leverage.",
};

// leverage for a trade: one row, the label and the steps up to the market's max
function Leverage({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const steps = [...new Set([1, 2, 5, 10, 20, 40, max].filter((v) => v <= max))].slice(-5);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-white/45">
        <Tip text="Higher leverage, smaller margin, closer liquidation." align="start">Leverage</Tip>
      </span>
      <div className="ml-auto flex gap-1 rounded-[11px] bg-[#1c1b1a] p-1">
        {steps.map((v) => (
          <button key={v} onClick={() => onChange(v)} className={`h-7 min-w-[40px] rounded-[8px] px-2 text-[13px] font-semibold tabular-nums transition-colors duration-150 ${v === value ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/75"}`}>
            {v}x
          </button>
        ))}
      </div>
    </div>
  );
}

// where SOL is now against the rule: entry (coral) on the left, recovery (white) on the right,
// the live price as a dot between them, and how far each line is from here
function RuleTrack({ mark, entry, recovery }: { mark?: number; entry: number; recovery: number }) {
  if (!mark || !entry || recovery <= entry) return null;
  const lo = entry - (recovery - entry) * 0.15;
  const hi = recovery + (recovery - entry) * 0.15;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const toEntry = entry / mark - 1;
  const toRecovery = recovery / mark - 1;
  return (
    <div>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.12]" />
        <span className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: at(entry), background: CORAL }} />
        <span className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: at(recovery) }} />
        <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-4 ring-[#0b0908] transition-[left] duration-500 ease-out" style={{ left: at(mark) }} />
      </div>
      <div className="mt-1 flex justify-between text-[12px] tabular-nums">
        <span style={{ color: CORAL }}>
          <Tip text="The short opens if SOL falls to this price." align="start">Entry {usd(entry)}</Tip>
          <span className="block text-white/40">{pct(toEntry)} from now</span>
        </span>
        <span className="text-center text-white/70">
          Now {usd(mark)}
        </span>
        <span className="text-right text-white/70">
          <Tip text="The hedge closes as SOL recovers here. Runs once." align="end">Recovery {usd(recovery)}</Tip>
          <span className="block text-white/40">{pct(toRecovery)} from now</span>
        </span>
      </div>
    </div>
  );
}
