"use client";

import { ArrowLeft, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { haptic } from "@/lib/haptics";
import { BagLoader, NumberRoll, StatusText } from "@/components/motion";
import { Chart } from "./chart";
import { Ticket } from "./ticket";
import { CoinLogo } from "./coin-logo";
import { Tip } from "./tip";
import { useCoin, useAccount, type Interval, type Trade } from "./app/hl";
import { FUNDING, STATUS, useStore } from "./app/store";
import { ruleLabel as ruleLabelText } from "./app/live";
import { DOWN, UP, compact, pct, priceDecimals, risk, time, tone, usd } from "./app/format";

const RANGES: Record<string, [Interval, number]> = { "1H": ["1m", 1], "1D": ["15m", 24], "1W": ["1h", 168], "1M": ["4h", 720] };

// one market: price and stats, the chart, the live tape and positions, and the ticket.
// SOL also carries the hedge (entry and recovery on the chart, the hedge ticket)
export function CoinPage({ coin }: { coin: string }) {
  const store = useStore();
  const { markets, mids, hedge: h, accounts, liveEnabled, liveHedge, backend, canTrade, trading } = store;
  const [closing, setClosing] = useState<string | null>(null);
  const L = liveEnabled ? liveHedge : null;
  const [range, setRange] = useState("1D");
  const market = markets.find((m) => m.name === coin);
  const { ctx, trades, candles } = useCoin(market ? coin : null, ...RANGES[range]);
  const mark = ctx?.mark ?? mids[coin] ?? market?.mark;
  const prevDay = ctx?.prevDay ?? market?.prevDay;
  const change = mark && prevDay ? mark / prevDay - 1 : 0;
  const maxLev = market?.maxLeverage ?? 20;
  const decimals = market && mark ? priceDecimals(mark, market.szDecimals) : 2;
  const isSol = coin === "SOL";
  const [review, setReview] = useState(false);
  const [sheet, setSheet] = useState(false);
  const armed = !["draft", ...FUNDING, "closed"].includes(h.phase);
  const tradeAccount = useAccount(accounts.trade || null).account;
  const positions = tradeAccount?.positions.filter((p) => p.coin === coin) ?? [];

  if (markets.length && !market)
    return (
      <section className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[20px] font-semibold">No {coin} market</p>
          <Link href="/markets" className="mt-4 inline-block rounded-[12px] bg-[#1c1b1a] px-4 py-2.5 text-[14px] font-semibold">All markets</Link>
        </div>
      </section>
    );

  const ticket = <Ticket coin={coin} mark={mark} change={change} maxLev={maxLev} onReview={() => setReview(true)} />;
  const r = risk(h.capN, h.entry, h.recovery, maxLev);

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-h-0 flex-col">
        <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-7">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/markets" aria-label="All markets" className="text-white/55 hover:text-white"><ArrowLeft size={20} /></Link>
              <CoinLogo coin={coin} className="size-8" />
              <span className="text-[18px] font-semibold">{coin}</span>
              <span className="rounded-[7px] bg-[#1c1b1a] px-2 py-0.5 text-[12px] text-white/60"><Tip text="The most leverage Hyperliquid allows on this market." side="bottom" align="start">{maxLev}x</Tip></span>
            </div>
            <div className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.03em] sm:text-[46px]">
              {mark ? <NumberRoll value={mark} format={(n) => usd(n, decimals)} /> : <BagLoader size={34} label={`Loading ${coin}`} />}
            </div>
            {mark && <p className="mt-2 text-[14px] font-medium" style={{ color: tone(change) }}>{pct(change)} <span className="font-normal text-white/45">24h</span></p>}
          </div>
          {market && (
            <div className="hidden gap-7 pt-1 text-right md:flex">
              <Stat label="Funding" tip="Paid hourly between longs and shorts. Positive means longs pay." value={`${((ctx?.funding ?? market.funding) * 100).toFixed(4)}%`} />
              <Stat label="Open interest" tip="Value of all open positions in this market." value={compact(ctx?.oi ?? market.oi)} />
              <Stat label="24h volume" tip="Value traded in this market over the last 24 hours." value={compact(market.volume)} />
            </div>
          )}
        </header>

        <div className="flex items-center gap-0.5 px-5 pb-2 sm:px-7">
          {Object.keys(RANGES).map((k) => (
            <button key={k} onClick={() => setRange(k)} className={`rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${k === range ? "bg-[#1c1b1a] text-white" : "text-white/45 hover:text-white"}`}>
              {k}
            </button>
          ))}
        </div>

        <div className="relative min-h-[240px] flex-1">
          {candles.length > 1 ? (
            <Chart
              key={coin}
              candles={candles}
              decimals={decimals}
              rule={isSol ? { entry: h.entry, recovery: h.recovery, editing: h.phase === "draft", armed, onEntry: h.setEntry, onRecovery: h.setRecovery } : undefined}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center"><BagLoader size={48} label="Loading candles" /></div>
          )}
        </div>

        {/* the tape and positions, side by side on desktop */}
        <div className="grid h-[200px] shrink-0 border-t border-white/[0.08] md:grid-cols-2 lg:h-[230px]">
          <Tape trades={trades} coin={coin} decimals={decimals} />
          <div className="hidden min-h-0 flex-col border-l border-white/[0.08] md:flex">
            <p className="px-5 pb-2 pt-3.5 text-[14px] font-semibold">Positions</p>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {isSol && L?.rule && L.rule.status === "active" && Number(L.rule.shortLots) > 0 && (
                <Row
                  title="Short"
                  sub={`${backend.mode === "testnet" ? "Testnet" : "Mainnet"} · Hedge account`}
                  value={`${(Number(L.rule.shortLots) / 10 ** (market?.szDecimals ?? 2)).toFixed(market?.szDecimals ?? 2)} SOL`}
                  note={ruleLabelText(L.rule)}
                  coin={coin}
                />
              )}
              {isSol && !L && h.hedge !== 0 && (
                <Row
                  title="Short"
                  sub={<><Tip text="Simulated hedge. Nothing is signed or sent." side="bottom" align="start">Replay</Tip> · <StatusText text={STATUS[h.phase]} tone="plain" /></>}
                  value={<NumberRoll value={h.hedge} format={(n) => `${n.toFixed(2)} SOL`} />}
                  note={mark ? usd(Math.abs(h.hedge) * mark) : ""}
                  coin={coin}
                />
              )}
              {positions.map((p) => (
                <Row
                  key={p.coin}
                  title={p.size < 0 ? "Short" : "Long"}
                  sub={`Trade account · ${p.leverage}x`}
                  value={`${Math.abs(p.size)} ${coin}`}
                  note={<span style={{ color: tone(p.pnl) }}>{usd(p.pnl, 2)}</span>}
                  coin={coin}
                  action={
                    canTrade && mark ? (
                      <button
                        disabled={!!trading.busy}
                        onClick={() => {
                          haptic("tap");
                          setClosing(p.coin);
                          trading.close({ coin: p.coin, size: p.size, mark }).then((r) => {
                            haptic(r ? "success" : "error");
                            setClosing(null);
                          });
                        }}
                        className="h-8 rounded-[10px] bg-[#1c1b1a] px-3 text-[13px] font-semibold transition-colors duration-150 hover:bg-[#2e2c2a] disabled:opacity-50"
                      >
                        {closing === p.coin ? "Closing" : "Close"}
                      </button>
                    ) : null
                  }
                />
              ))}
              {!(isSol && (L ? L.rule && Number(L.rule.shortLots) > 0 : h.hedge !== 0)) && !positions.length && (
                <div className="flex h-full flex-col items-center justify-center gap-2 pb-6 text-center">
                  <p className="text-[14px] text-white/45">No {coin} position</p>
                  {!accounts.trade && <Link href="/portfolio" className="text-[13px] font-medium text-white/70 hover:text-white">Add a Hyperliquid account</Link>}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ticket: a column on desktop, a bottom sheet on a phone */}
      <aside className="hidden min-h-0 flex-col border-l border-white/[0.08] lg:flex">{ticket}</aside>
      <div className="fixed inset-x-0 bottom-16 z-30 bg-[#0b0908] px-3 pb-2 pt-1 lg:hidden">
        <button onClick={() => setSheet(true)} className="h-12 w-full rounded-[14px] bg-[#f0645a] text-[16px] font-semibold">
          {isSol ? (h.phase === "draft" ? "Hedge or trade SOL" : STATUS[h.phase]) : `Trade ${coin}`}
        </button>
      </div>
      <div className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden ${sheet ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setSheet(false)}>
        <div className={`absolute inset-x-0 bottom-0 flex h-[90svh] flex-col rounded-t-[24px] bg-[#0b0908] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${sheet ? "translate-y-0" : "translate-y-full"}`} onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-white/20" />
          {ticket}
        </div>
      </div>

      {/* review before anything is signed */}
      <div className={`fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 transition-opacity duration-200 ${review ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => { setReview(false); L?.cancelDraft(); }}>
        <div role="dialog" aria-modal="true" aria-label="Review" className={`w-full max-w-[380px] rounded-[24px] bg-[#141312] p-5 transition-transform duration-200 ease-out ${review ? "scale-100" : "scale-95"}`} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[36px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{h.capN} SOL</p>
              <p className="mt-2 text-[13px] text-white/45 tabular-nums">
                {mark ? `${usd(h.capN * mark)} · ` : ""}runs once, 7 days
              </p>
            </div>
            <button onClick={() => { setReview(false); L?.cancelDraft(); }} className="grid size-8 place-items-center rounded-full bg-[#1c1b1a] text-white/55 hover:text-white" aria-label="Close review"><X size={15} /></button>
          </div>
          {/* the four numbers that matter, two by two */}
          <div className="mt-5 grid grid-cols-2 gap-1.5 text-[13px]">
            {[
              ["Entry", usd(h.entry), "Below this, the short opens."],
              ["Recovery", usd(h.recovery), "Back above this, the short closes."],
              ["Margin", L?.margin ? usd(L.margin.need, 2) : usd(r.margin), "Held in the Hedge account. It comes back."],
              ["Fees", L ? "0.045%" : usd(r.fees), "Hyperliquid's fee on each fill."],
            ].map(([k, v, tip]) => (
              <div key={k} className="rounded-[12px] bg-[#1c1b1a] px-3 py-2.5">
                <p className="text-white/45"><Tip text={tip} side="top" align="start">{k}</Tip></p>
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {L ? (
            <>
              {/* the backend's own disclosures (GET /api/health), shown before anyone funds the Hedge account */}
              {backend.disclosures.length > 0 && (
                <details className="group mt-3 text-[12px] leading-snug text-white/55">
                  <summary className="cursor-pointer list-none font-semibold text-white/70 hover:text-white">Disclosure: the guard&apos;s key <span className="text-white/40 group-open:hidden">· read</span></summary>
                  {backend.disclosures.map((d) => <p key={d} className="mt-1.5">{d}</p>)}
                </details>
              )}
              {L.margin && L.margin.have === null && (
                <p className="mt-3 rounded-[12px] bg-[#1c1b1a] px-3.5 py-3 text-[13px] leading-snug text-white/75">
                  Margin unavailable right now. Arming checks it again.
                </p>
              )}
              {L.margin && L.margin.have !== null && L.margin.have < L.margin.need && (
                <p className="mt-3 rounded-[12px] bg-[#1c1b1a] px-3.5 py-3 text-[13px] leading-snug text-white/75">
                  The Hedge account holds {usd(L.margin.have, 2)} and needs {usd(L.margin.need, 2)}.{" "}
                  <button
                    onClick={() => {
                      haptic("tap");
                      store.funds.open("fund", "hedge");
                    }}
                    className="font-semibold text-white underline underline-offset-2"
                  >
                    {backend.mode === "testnet" ? "Get test USDC" : "Add funds"}
                  </button>
                </p>
              )}
              <button
                // never sign a policy the Hedge account can't carry: fund first
                disabled={!!L.busy || (!!L.margin && L.margin.have !== null && L.margin.have < L.margin.need)}
                onClick={() =>
                  L.arm().then((ok) => {
                    if (!ok) return;
                    setReview(false);
                    setSheet(false);
                  })
                }
                className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#f0645a] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:bg-[#1c1b1a] disabled:text-white/60"
              >
                {L.busy ? ({ signin: "Signing in", agent: "Finding your hedge agent", approve: "Approving the hedge agent", arm: "Signing the policy" } as Record<string, string>)[L.busy] ?? "Working" : "Sign and arm"}
              </button>
              <p aria-live="polite" className="mt-2 min-h-[18px] text-center text-[12px] leading-snug text-[#f2554b]">{L.error?.message ?? ""}</p>
              <p className="text-center text-[12px] text-white/40">
                {backend.mode === "testnet" ? "Testnet" : "Mainnet"}
                {backend.signer === "fallback" ? " · demo signer, not the attested guard" : " · signed by the attested guard"}
              </p>
            </>
          ) : (
            <>
              <button onClick={() => { setReview(false); setSheet(false); h.setPhase("signing"); }} className="mt-6 h-[52px] w-full rounded-[14px] bg-[#f0645a] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98]">
                Sign and fund
              </button>
              <p className="mt-3 text-center text-[12px] text-white/40">Replay. Nothing is signed.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// the live tape. trades that arrive after the first load slide in and flash their side's colour
function Tape({ trades, coin, decimals }: { trades: Trade[]; coin: string; decimals: number }) {
  const [since] = useState(() => Date.now());
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-5 pb-2 pt-3.5 text-[14px] sm:px-7">
        <span className="font-semibold"><Tip text="Live fills on Hyperliquid. Green buys, red sells." align="start">Trades</Tip></span>
        <span className="text-[12px] text-white/40">Size · Price · Time</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {trades.length ? (
          trades.map((t) => (
            <div
              key={t.tid}
              className={`grid grid-cols-[1fr_auto_72px] items-center gap-4 px-5 py-[6px] text-[14px] tabular-nums sm:px-7 ${t.time > since ? "row-in" : ""}`}
              style={{ ["--flash" as string]: t.side === "B" ? "rgb(62 207 142 / 0.14)" : "rgb(242 85 75 / 0.14)" }}
            >
              <span style={{ color: t.side === "B" ? UP : DOWN }}>{t.sz.toLocaleString("en-US", { maximumFractionDigits: 4 })} {coin}</span>
              <span>{t.px.toFixed(decimals)}</span>
              <span className="text-right text-white/40">{time(t.time)}</span>
            </div>
          ))
        ) : (
          <div className="grid h-full place-items-center"><BagLoader size={28} label="Loading trades" /></div>
        )}
      </div>
    </div>
  );
}

function Row({ title, sub, value, note, coin, action }: { title: string; sub: React.ReactNode; value: React.ReactNode; note: React.ReactNode; coin: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <CoinLogo coin={coin} className="size-9" />
      <div className="leading-tight">
        <p className="text-[15px] font-semibold" style={{ color: title === "Short" ? DOWN : UP }}>{title}</p>
        <p className="text-[13px] text-white/45">{sub}</p>
      </div>
      <div className="ml-auto text-right leading-tight tabular-nums">
        <p className="text-[15px] font-semibold">{value}</p>
        <p className="text-[13px] text-white/45">{note}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="leading-tight">
      <p className="text-[15px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[12px] text-white/45">{tip ? <Tip text={tip} side="bottom" align="end">{label}</Tip> : label}</p>
    </div>
  );
}
