"use client";

import { Backspace } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BagLoader, ExposureDots, StatusText, TransferTrack } from "@/components/motion";
import { CoinLogo } from "./coin-logo";
import { AUTO, FUNDING, STATUS, useStore, type Phase } from "./app/store";
import { CORAL, DOWN, INK, TAKER, UP, pct, risk, usd } from "./app/format";

// fomo's buy panel: coin row, big amount, chips, pad, summary, action, estimates.
// Hedge (SOL only) sizes against the watched wallet; Trade sizes a market order in dollars
export function Ticket({ coin, mark, change, maxLev, onReview }: { coin: string; mark?: number; change: number; maxLev: number; onReview: () => void }) {
  const { wallet, hedge: h, toast } = useStore();
  const canHedge = coin === "SOL";
  const [modeState, setMode] = useState<"Hedge" | "Trade">("Hedge");
  const mode = canHedge ? modeState : "Trade";
  const hedgeMode = mode === "Hedge";
  const [usdIn, setUsdIn] = useState("100");
  const draft = h.phase === "draft";
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

  const step = FUNDING.indexOf(h.phase);
  const busy = hedgeMode && !!AUTO[h.phase];
  const over = hedgeMode && (Number(h.cap) || 0) > h.held + 1e-9;
  const label = !connected
    ? "Connect wallet"
    : ({ draft: "Review hedge", credited: "Arm", armed: "Simulate a crossing", open: "Close hedge", closed: "New hedge" } as Partial<Record<Phase, string>>)[h.phase];
  const MIN = 10;
  const belowMin = hedgeMode && !!mark && h.capN > 0 && h.capN * mark < MIN;
  const why = !connected || !draft ? null : h.capN <= 0 ? "Enter an amount" : over ? "More than you hold" : belowMin ? `Below the $${MIN} minimum` : h.recovery <= h.entry ? "Recovery must sit above entry" : null;
  const disabled = connected && (!label || busy || !!why);
  const tradeBelowMin = !hedgeMode && (Number(usdIn) || 0) < MIN;
  const act = () => {
    if (!connected) return wallet.connect();
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
          <p className="text-[13px] text-white/45">{hedgeMode ? (connected ? `${h.held.toFixed(2)} in wallet` : "Not connected") : `Up to ${maxLev}x`}</p>
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
                  {" · covers "}
                  <span className="text-white">{Math.min(999, Math.round(((Number(h.cap) || 0) / h.held) * 100))}%</span>
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

      <p className="mt-auto pt-4 text-center text-[13px] text-white/45 tabular-nums">
        {hedgeMode ? (
          <>
            <span style={{ color: CORAL }}>Entry {usd(h.entry)}</span> · Recovery {usd(h.recovery)}
          </>
        ) : (
          tradeBelowMin ? `Minimum $${MIN}` : `Fee ${usd((Number(usdIn) || 0) * TAKER, 2)}`
        )}
      </p>

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
      {hedgeMode && !draft && <StatusText text={`Replay · ${STATUS[h.phase]}`} className="mt-2 block text-center text-[13px] text-white/55" />}

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
                ["Taker fee", "0.045%"],
                ["Max leverage", `${maxLev}x`],
              ]
          ).map(([k, v]) => (
            <div key={k} className="leading-tight">
              <p className="text-[12px] text-white/45">{k}</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
