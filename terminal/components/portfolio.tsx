"use client";

import Link from "next/link";
import { useState } from "react";
import { BagLoader, ExposureDots, NumberRoll, StatusText } from "@/components/motion";
import { WalletAvatar } from "./avatar";
import { CoinLogo } from "./coin-logo";
import { useAccount } from "./app/hl";
import { STATUS, useStore } from "./app/store";
import { compact, tone, usd } from "./app/format";
import { isEvmAddress, short } from "./app/wallet";
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
          <div className="flex flex-1 flex-col rounded-[20px] bg-[#141312] p-6">
            <p className="text-[13px] text-white/45">Wallet</p>
            {wallet.address ? (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <WalletAvatar address={wallet.address} size={44} />
                  <div className="leading-tight">
                    <p className="text-[15px] font-semibold">{wallet.connected ? wallet.name : "Watching"}</p>
                    <p className="text-[13px] text-white/45">{short(wallet.address)}</p>
                  </div>
                </div>
                <div className="mt-auto pt-6">
                  <p className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                    {wallet.sol === null ? <BagLoader size={30} label="Reading balance" /> : <NumberRoll value={wallet.sol} format={(n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`} />}
                  </p>
                  <p className="mt-2 text-[14px] text-white/45 tabular-nums">{wallet.sol !== null && mark ? usd(wallet.sol * mark) : " "}</p>
                </div>
              </>
            ) : (
              <div className="mt-auto">
                <ExposureDots watched={20} hedged={0} per={1} size={12} className="mb-6 w-[174px] opacity-25" />
                <p className="text-[20px] font-semibold tracking-[-0.02em]">No wallet yet</p>
                <p className="mt-1 text-[14px] text-white/45">Connect one, or watch any address.</p>
                <div className="-mx-4 -mb-4 max-w-[340px]">
                  <WalletBox />
                </div>
              </div>
            )}
          </div>

          {/* the hedge on it */}
          <div className="flex flex-1 flex-col rounded-[20px] bg-[#141312] p-6">
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
    <div className="flex min-h-[420px] flex-col rounded-[20px] bg-[#141312] p-6 lg:min-h-0">
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
          className="mt-auto flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const a = input.trim();
            if (!isEvmAddress(a)) return setBad("That isn't a Hyperliquid address");
            if (other && a.toLowerCase() === other.toLowerCase()) return setBad("Trade and Hedge must be different accounts");
            setAccounts({ ...accounts, [role]: a });
            setInput("");
          }}
        >
          <div className="mb-8 flex flex-col gap-3 opacity-40" aria-hidden>
            {[0.9, 0.7, 0.8, 0.55].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="size-8 rounded-full bg-[#1c1b1a]" />
                <span className="h-3 rounded-full bg-[#1c1b1a]" style={{ width: `${w * 40}%` }} />
                <span className="ml-auto h-3 w-16 rounded-full bg-[#1c1b1a]" />
              </div>
            ))}
          </div>
          <p className="text-[20px] font-semibold tracking-[-0.02em]">Add your {role === "trade" ? "Trade" : "Hedge"} account</p>
          <p className="mt-1 text-[14px] text-white/45">{role === "trade" ? "The account you trade from by hand." : "The separate account that holds the hedge short."} Read only.</p>
          <div className="mt-4 flex gap-2">
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setBad(null);
              }}
              placeholder="0x…"
              aria-invalid={!!bad}
              className={`h-11 min-w-0 flex-1 rounded-[12px] bg-[#1c1b1a] px-3 text-[14px] outline-none ring-1 placeholder:text-white/35 ${bad ? "ring-[#f2554b]" : "ring-transparent focus:ring-white/15"}`}
            />
            <button className="h-11 rounded-[12px] bg-[#f0645a] px-4 text-[14px] font-semibold transition-transform duration-150 active:scale-[0.98]">Add</button>
          </div>
          <p className="mt-2 h-4 text-[12px] text-[#f2554b]">{bad}</p>
        </form>
      ) : error && !account ? (
        <div className="grid flex-1 place-items-center text-center">
          <p className="text-[14px] text-white/55">Couldn&apos;t reach Hyperliquid. Retrying.</p>
        </div>
      ) : !account ? (
        <div className="grid flex-1 place-items-center"><BagLoader size={32} label="Reading account" /></div>
      ) : (
        <>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{usd(account.equity, 2)}</p>
              <p className="mt-2 text-[13px] text-white/45 tabular-nums">Equity · {usd(account.withdrawable, 2)} withdrawable</p>
            </div>
            <button onClick={() => setAccounts({ ...accounts, [role]: "" })} className="text-[12px] text-white/45 transition-colors hover:text-white">
              {short(address)} · Remove
            </button>
          </div>
          <div className="mt-5 flex items-center justify-between border-b border-white/[0.08] pb-2 text-[12px] text-white/40">
            <span>{account.positions.length} open</span>
            <span>Value · PnL</span>
          </div>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
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
    <svg viewBox="0 0 240 64" className="mb-6 w-[240px] max-w-full" aria-hidden>
      <line x1="4" x2="236" y1="16" y2="16" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round" strokeDasharray="0 11" />
      <line x1="4" x2="236" y1="48" y2="48" stroke="#f0645a" strokeOpacity="0.6" strokeWidth="6" strokeLinecap="round" strokeDasharray="0 11" />
    </svg>
  );
}
