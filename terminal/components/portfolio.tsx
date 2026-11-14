"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BagLoader, ExposureDots, NumberRoll, StatusText } from "@/components/motion";
import { WalletAvatar } from "./avatar";
import { CopyAddress } from "./copy-address";
import { CoinLogo } from "./coin-logo";
import { info, useAccount } from "./app/hl";
import { STATUS, useStore } from "./app/store";
import { DOWN, UP, compact, pct, tone, usd } from "./app/format";
import { isEvmAddress } from "./app/wallet";
import { WalletBox } from "./shell";

// one screen, three parts: the watched SOL and the hedge on it (left), the hyperliquid accounts (right).
// lists scroll inside their card, never the page
export function PortfolioPage() {
  const { wallet, mids, hedge: h } = useStore();
  const mark = mids.SOL;
  const active = h.phase !== "draft" || h.hedge !== 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto lg:overflow-hidden">
      <h1 className="px-5 pb-4 pt-5 text-[26px] font-semibold tracking-[-0.03em] sm:px-7">Portfolio</h1>
      <div className="grid min-h-0 flex-1 gap-4 px-5 pb-5 sm:px-7 sm:pb-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="flex min-h-0 flex-col gap-4">
          {/* the watched wallet */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-[#141312] p-6">
            <p className="text-[13px] text-white/45">Wallet</p>
            {wallet.address ? (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <WalletAvatar address={wallet.address} size={44} />
                  <div className="leading-tight">
                    <p className="text-[15px] font-semibold">{wallet.connected ? wallet.name : "Watching"}</p>
                    <CopyAddress address={wallet.address} className="text-[13px]" />
                  </div>
                </div>
                <ValueChart sol={wallet.sol} mark={mark} />
                <div className="pt-4">
                  <p className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                    {wallet.sol === null ? <BagLoader size={30} label="Reading balance" /> : <NumberRoll value={wallet.sol} format={(n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`} />}
                  </p>
                  <p className="mt-2 text-[14px] text-white/45 tabular-nums">{wallet.sol !== null && mark ? usd(wallet.sol * mark) : " "}</p>
                </div>
              </>
            ) : (
              <div className="mt-auto">
                <ExposureDots watched={20} hedged={0} per={1} size={12} className="mb-6 w-[174px] opacity-25 [@media(max-height:860px)]:hidden" />
                <p className="text-[20px] font-semibold tracking-[-0.02em]">No wallet yet</p>
                <p className="mt-1 text-[14px] text-white/45">Connect one, or watch any address read only.</p>
                <div className="-mx-4 -mb-4 max-w-[340px]">
                  <WalletBox />
                </div>
              </div>
            )}
          </div>

          {/* the hedge on it */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-[#141312] p-6">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-white/45">Hedge</p>
              <span className="rounded-[7px] bg-[#1c1b1a] px-2 py-0.5 text-[12px] text-white/55">Replay</span>
            </div>
            {active ? (
              <>
                <StatusText text={STATUS[h.phase]} className="mt-4 block text-[15px] font-semibold" />
                <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                  <div>
                    <p className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                      <NumberRoll value={h.hedge} format={(n) => `${n.toFixed(2)} SOL`} />
                    </p>
                    <p className="mt-2 text-[14px] text-white/45 tabular-nums">Entry {usd(h.entry)} · Recovery {usd(h.recovery)}</p>
                  </div>
                  {h.held > 0 && <ExposureDots watched={h.held} hedged={h.hedge} per={h.held / 20} size={10} className="w-[140px]" />}
                </div>
                <Link href="/" className="mt-5 text-[14px] font-semibold text-white/70 hover:text-white">Open the hedge</Link>
              </>
            ) : (
              <div className="mt-auto">
                <RuleSketch />
                <p className="text-[20px] font-semibold tracking-[-0.02em]">No hedge yet</p>
                <p className="mt-1 text-[14px] text-white/45 tabular-nums">Draw an entry and a recovery on SOL. It runs once.</p>
                <Link href="/" className="mt-4 inline-flex h-11 items-center rounded-[12px] bg-[#f0645a] px-4 text-[15px] font-semibold transition-transform duration-150 active:scale-[0.98]">
                  Set up a hedge
                </Link>
              </div>
            )}
          </div>
        </div>

        <Accounts />
      </div>
    </section>
  );
}

// the two hyperliquid master accounts by public address, mainnet. Trade and Hedge must differ (AGENTS.md rule 8)
function Accounts() {
  const { accounts, setAccounts } = useStore();
  const [role, setRole] = useState<"trade" | "hedge">("trade");
  const address = accounts[role];
  const other = accounts[role === "trade" ? "hedge" : "trade"];
  const { account, error } = useAccount(address || null);
  const [input, setInput] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  return (
    <div className={`flex min-h-[420px] flex-col overflow-hidden rounded-[20px] bg-[#141312] px-6 pt-6 lg:min-h-0 ${account && address ? "pb-0" : "pb-6"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-white/45">Hyperliquid accounts</p>
        <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[#1c1b1a] p-1">
          {(["trade", "hedge"] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                setBad(null);
              }}
              className={`h-8 rounded-[9px] px-3 text-[13px] font-semibold transition-colors duration-150 ${role === r ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/70"}`}
            >
              {r === "trade" ? "Trade" : "Hedge"}
            </button>
          ))}
        </div>
      </div>

      {!address ? (
        <form
          className="grid min-h-0 flex-1 place-items-center py-6"
          onSubmit={(e) => {
            e.preventDefault();
            const a = input.trim();
            if (!isEvmAddress(a)) return setBad("That isn't a Hyperliquid address");
            if (other && a.toLowerCase() === other.toLowerCase()) return setBad("Trade and Hedge must be different accounts");
            setAccounts({ ...accounts, [role]: a });
            setInput("");
          }}
        >
          {/* one centred group: the art, what this account is, and the field to add it */}
          <div key={role} className="flex w-full max-w-[400px] flex-col items-center text-center [animation:toast-in_300ms_cubic-bezier(0.19,1,0.22,1)]">
            {/* halftone art (codex, the landing's style); its black drops out on the card */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={role === "trade" ? "/art/trade-account.webp" : "/art/hedge-account.webp"} alt="" className="-my-6 w-[260px] mix-blend-screen [@media(max-height:760px)]:hidden" />
            <p className="text-[20px] font-semibold tracking-[-0.02em]">Add your {role === "trade" ? "Trade" : "Hedge"} account</p>
            <p className="mt-1 text-[14px] text-white/45">{role === "trade" ? "The account you trade from by hand." : "The separate account that holds the hedge short."} Read only.</p>
            <div className="mt-5 flex w-full gap-2">
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setBad(null);
                }}
                placeholder="0x…"
                aria-invalid={!!bad}
                spellCheck={false}
                className={`h-11 min-w-0 flex-1 rounded-[12px] bg-[#1c1b1a] px-3 text-[14px] outline-none ring-1 placeholder:text-white/35 ${bad ? "ring-[#f2554b]" : "ring-transparent focus:ring-white/15"}`}
              />
              <button className="h-11 rounded-[12px] bg-[#f0645a] px-4 text-[14px] font-semibold transition-transform duration-150 active:scale-[0.98]">Add</button>
            </div>
            <p className="mt-2 h-4 text-[12px] text-[#f2554b]">{bad}</p>
          </div>
        </form>
      ) : error && !account ? (
        <div className="grid flex-1 place-items-center text-center">
          <p className="text-[14px] text-white/55">Couldn&apos;t reach Hyperliquid. Retrying.</p>
        </div>
      ) : !account ? (
        <div className="grid flex-1 place-items-center"><BagLoader size={32} label="Reading account" /></div>
      ) : (
        <>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{usd(account.equity, 2)}</p>
              <p className="mt-2 text-[13px] text-white/45 tabular-nums">Equity · {usd(account.withdrawable, 2)} withdrawable</p>
            </div>
            <span className="flex h-8 shrink-0 items-center gap-1 rounded-[10px] bg-[#1c1b1a] pl-3 pr-1 text-[12px] text-white/70 tabular-nums">
              <CopyAddress address={address} />
              <button onClick={() => setAccounts({ ...accounts, [role]: "" })} className="grid size-6 place-items-center rounded-[7px] text-white/45 transition-colors hover:bg-[#2e2c2a] hover:text-white" aria-label="Remove account">
                ✕
              </button>
            </span>
          </div>
          <div className="mt-6 flex items-center justify-between pb-1 text-[12px] text-white/40">
            <span>
              Positions <span className="text-white/70">{account.positions.length}</span>
            </span>
            <span>Value · PnL</span>
          </div>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.08] pb-3 pt-1">
            {account.positions.length ? (
              account.positions.map((p) => (
                <Link key={p.coin} href={p.coin === "SOL" ? "/" : `/markets/${p.coin}`} className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors duration-100 hover:bg-[#1c1b1a]">
                  <CoinLogo coin={p.coin} className="size-8" />
                  <div className="min-w-0 leading-tight">
                    <p className="text-[14px] font-semibold">
                      {p.coin} <span className="font-normal" style={{ color: tone(p.size) }}>{p.size < 0 ? "Short" : "Long"} {p.leverage}x</span>
                    </p>
                    <p className="truncate text-[12px] text-white/45 tabular-nums">
                      {Math.abs(p.size).toLocaleString("en-US")} at {usd(p.entry)}
                      {p.liq ? ` · Liq ${usd(p.liq)}` : ""}
                    </p>
                  </div>
                  <div className="ml-auto text-right leading-tight tabular-nums">
                    <p className="text-[14px] font-semibold">{compact(p.value)}</p>
                    <p className="text-[12px]" style={{ color: tone(p.pnl) }}>{usd(p.pnl, 2)}</p>
                  </div>
                </Link>
              ))
            ) : (
              <p className="py-10 text-center text-[14px] text-white/45">No open positions</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// the hedge in two dotted lines: white recovery above, coral entry below, the way they sit on the chart
function RuleSketch() {
  return (
    <svg viewBox="0 0 240 64" className="mb-6 w-[240px] max-w-full [@media(max-height:860px)]:hidden" aria-hidden>
      <line x1="4" x2="236" y1="16" y2="16" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round" strokeDasharray="0 11" />
      <line x1="4" x2="236" y1="48" y2="48" stroke="#f0645a" strokeOpacity="0.6" strokeWidth="6" strokeLinecap="round" strokeDasharray="0 11" />
    </svg>
  );
}

// what the watched SOL was worth over 7 days, at today's balance (hourly SOL closes from hyperliquid, live last point)
function ValueChart({ sol, mark }: { sol: number | null; mark?: number }) {
  const [closes, setCloses] = useState<number[]>([]);
  useEffect(() => {
    const end = Date.now();
    info<{ c: string }[]>({ type: "candleSnapshot", req: { coin: "SOL", interval: "1h", startTime: end - 7 * 86_400_000, endTime: end } })
      .then((rows) => setCloses(rows.map((r) => Number(r.c))))
      .catch(() => {});
  }, []);
  if (sol === null || closes.length < 2) return <div className="mt-4 min-h-[48px] flex-1" />;
  const pts = mark ? [...closes.slice(0, -1), mark] : closes;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const w = 100, h = 40;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - ((v - lo) / span) * (h - 4) - 2] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const change = pts[pts.length - 1] / pts[0] - 1;
  const color = change < 0 ? DOWN : UP;
  return (
    <div className="mt-4 flex min-h-[48px] flex-1 flex-col">
      <div className="flex items-center justify-between text-[12px] text-white/40 tabular-nums">
        <span>7 days at today&apos;s balance</span>
        <span style={{ color }}>{usd(sol * (pts[pts.length - 1] - pts[0]), 2)} · {pct(change)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 min-h-0 w-full flex-1" aria-label={`Value ${pct(change)} over 7 days`}>
        <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
