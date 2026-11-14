"use client";

import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BagLoader } from "@/components/motion";
import { CoinLogo } from "./coin-logo";
import { Tip } from "./tip";
import { useStore } from "./app/store";
import { coinHref, compact, pct, priceDecimals, tone, usd } from "./app/format";
import { haptic } from "@/lib/haptics";
import { Offline, useAfter } from "./offline";

type Sort = "volume" | "change" | "funding" | "oi";
type Filter = "All" | "Gainers" | "Losers";
const COLS: { key: Sort; label: string; tip: string }[] = [
  { key: "change", label: "24h", tip: "Price change over the last 24 hours" },
  { key: "volume", label: "Volume", tip: "Value traded in the last 24 hours" },
  { key: "oi", label: "Open interest", tip: "Value of all open positions" },
  { key: "funding", label: "Funding", tip: "Paid hourly between longs and shorts. Positive: longs pay" },
];
const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_1fr_0.8fr_1fr_1fr_0.9fr]";

// every hyperliquid perp, live: prices from the socket, the rest from a snapshot each minute.
// four live headline cards, filters, sortable columns, and prices that flash when they move
export function MarketsPage() {
  const { markets, mids, live } = useStore();
  // the snapshot retries each minute; past a normal load, show a calm offline state instead of a spinner forever
  const unreachable = useAfter(!markets.length, 9000);
  // the socket dropped: prices keep coming by polling, so it's a quiet note, not an error
  const polling = useAfter(!!markets.length && !live, 8000);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("volume");
  const [filter, setFilter] = useState<Filter>("All");
  const search = useRef<HTMLInputElement>(null);

  // "/" jumps to search, as in most terminals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement).closest("input, textarea")) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = useMemo(
    () =>
      markets.map((m) => {
        const px = mids[m.name] ?? m.mark;
        return { ...m, px, change: m.prevDay ? px / m.prevDay - 1 : 0 };
      }),
    [markets, mids],
  );

  const rows = useMemo(() => {
    const list = all
      .filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
      .filter((m) => (filter === "Gainers" ? m.change > 0 : filter === "Losers" ? m.change < 0 : true));
    if (filter === "Gainers") return list.sort((a, b) => b.change - a.change);
    if (filter === "Losers") return list.sort((a, b) => a.change - b.change);
    return list.sort((a, b) => (sort === "change" ? Math.abs(b.change) - Math.abs(a.change) : b[sort] - a[sort]));
  }, [all, q, sort, filter]);

  // headline cards, among markets with real volume so a thin coin can't top the list
  const liquid = all.filter((m) => m.volume > 1_000_000);
  const top = liquid.length
    ? {
        gainer: liquid.reduce((a, b) => (b.change > a.change ? b : a)),
        loser: liquid.reduce((a, b) => (b.change < a.change ? b : a)),
        volume: liquid.reduce((a, b) => (b.volume > a.volume ? b : a)),
        funding: liquid.reduce((a, b) => (Math.abs(b.funding) > Math.abs(a.funding) ? b : a)),
      }
    : null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-7">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Markets</h1>
          <p className="text-[13px] text-white/45">
            {markets.length ? `${markets.length} perps on Hyperliquid` : " "}
            {polling && <span className="inline-error-in"> · Live feed reconnecting</span>}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="grid grid-cols-3 gap-1 rounded-[12px] bg-[#1c1b1a] p-1">
            {(["All", "Gainers", "Losers"] as const).map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => {
                  if (filter !== f) haptic("select");
                  setFilter(f);
                }}
                className={`h-8 rounded-[9px] px-3 text-[13px] font-semibold transition-colors duration-150 ${filter === f ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/70"}`}>
                {f}
              </button>
            ))}
          </div>
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-[#1c1b1a] px-3 sm:w-[260px] sm:flex-none">
            <MagnifyingGlass size={16} className="text-white/45" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-white/35" />
            <kbd className="hidden rounded-[6px] bg-[#2e2c2a] px-1.5 text-[11px] text-white/50 sm:block">/</kbd>
          </label>
        </div>
      </div>

      {top && (
        <div className="mx-auto grid w-full max-w-[1480px] grid-cols-2 gap-3 px-5 pb-5 sm:px-7 lg:grid-cols-4">
          <Headline label="Top gainer" tip="Biggest 24h rise among liquid markets" m={top.gainer} value={pct(top.gainer.change)} color={tone(top.gainer.change)} />
          <Headline label="Top loser" tip="Biggest 24h fall among liquid markets" m={top.loser} value={pct(top.loser.change)} color={tone(top.loser.change)} />
          <Headline label="Most traded" tip="Highest 24h volume" m={top.volume} value={compact(top.volume.volume)} />
          <Headline label="Hottest funding" tip="Largest hourly funding rate, either side" m={top.funding} value={`${(top.funding.funding * 100).toFixed(4)}%`} color={tone(top.funding.funding)} />
        </div>
      )}

      <div className="border-y border-white/[0.08]">
        <div className={`mx-auto grid w-full max-w-[1480px] ${GRID} gap-4 px-5 py-2.5 text-[12px] text-white/45 sm:px-7`}>
          <span>Market</span>
          <span className="text-right">Price</span>
          {COLS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                if (sort !== c.key || filter !== "All") haptic("select");
                setSort(c.key);
                setFilter("All");
              }}
              className={`hidden items-center justify-end gap-1 md:flex ${sort === c.key && filter === "All" ? "text-white" : "hover:text-white/70"}`}
            >
              <Tip text={c.tip} side="bottom" align={c.key === "funding" ? "end" : "center"}>{c.label}</Tip>
              {sort === c.key && filter === "All" && <CaretDown size={10} weight="bold" />}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!markets.length ? (
          <div className="grid h-full min-h-[280px] place-items-center">{unreachable ? <Offline /> : <BagLoader size={44} label="Loading markets" />}</div>
        ) : !rows.length ? (
          <div className="inline-error-in flex flex-col items-center px-5 py-12 text-center">
            <p className="max-w-full truncate text-[15px] font-semibold">{q.trim() ? `No market matches “${q.trim()}”` : filter === "Gainers" ? "No gainers right now" : "No losers right now"}</p>
            <p className="mt-1 text-[13px] text-white/45">{q.trim() ? "Try a ticker, like SOL or BTC." : "Prices are flat across the board."}</p>
            <button
              onClick={() => {
                haptic("tap");
                setQ("");
                setFilter("All");
                search.current?.focus();
              }}
              className="mt-4 h-10 rounded-[12px] bg-[#1c1b1a] px-4 text-[14px] font-semibold transition-colors duration-150 hover:bg-[#2e2c2a]"
            >
              {q.trim() ? "Clear search" : "Show all"}
            </button>
          </div>
        ) : (
          rows.map((m) => (
            <Link key={m.name} href={coinHref(m.name)} className="block transition-colors duration-100 hover:bg-[#141312]">
              <div className={`mx-auto grid w-full max-w-[1480px] ${GRID} items-center gap-4 px-5 py-3 text-[14px] tabular-nums sm:px-7`}>
                <span className="flex min-w-0 items-center gap-3">
                  <CoinLogo coin={m.name} className="size-8" />
                  <span className="truncate font-semibold">{m.name}</span>
                  <span className="shrink-0 rounded-[6px] bg-[#1c1b1a] px-1.5 py-0.5 text-[11px] text-white/55">{m.maxLeverage}x</span>
                  {m.name === "SOL" && <span className="shrink-0 rounded-[6px] bg-[#f0645a] px-1.5 py-0.5 text-[11px] font-semibold text-white">Hedge</span>}
                </span>
                <span className="text-right leading-tight">
                  <Flash value={m.px} className="block font-medium">{usd(m.px, priceDecimals(m.px, m.szDecimals))}</Flash>
                  <span className="block text-[12px] md:hidden" style={{ color: tone(m.change) }}>{pct(m.change)}</span>
                </span>
                <span className="hidden text-right md:block" style={{ color: tone(m.change) }}>{pct(m.change)}</span>
                <span className="hidden text-right text-white/80 md:block">{compact(m.volume)}</span>
                <span className="hidden text-right text-white/80 md:block">{compact(m.oi)}</span>
                <span className="hidden text-right md:block" style={{ color: tone(m.funding) }}>{(m.funding * 100).toFixed(4)}%</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function Headline({ label, tip, m, value, color }: { label: string; tip: string; m: { name: string; px: number; szDecimals: number }; value: string; color?: string }) {
  return (
    // a phone card is half the screen: name on top, the number under it. wider, all on one row
    <Link href={coinHref(m.name)} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-[16px] bg-[#141312] px-4 py-3.5 transition-colors duration-150 hover:bg-[#1c1b1a] sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <CoinLogo coin={m.name} className="size-8 sm:size-9" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[15px] font-semibold">{m.name}</p>
        <p className="mt-1 truncate text-[12px] text-white/45">
          <Tip text={tip} side="bottom" align="start">{label}</Tip>
        </p>
      </div>
      <div className="col-span-2 flex items-baseline justify-between gap-2 leading-tight tabular-nums sm:col-span-1 sm:block sm:text-right">
        <p className="text-[16px] font-semibold" style={{ color }}>{value}</p>
        <p className="truncate text-[12px] text-white/40 sm:mt-1">{usd(m.px, priceDecimals(m.px, m.szDecimals))}</p>
      </div>
    </Link>
  );
}

// a price that flashes green when it ticks up and red when it ticks down, like the trade tape
function Flash({ value, className, children }: { value: number; className?: string; children: React.ReactNode }) {
  const prev = useRef<number | null>(null);
  const [tick, setTick] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === null || p === value) return;
    const t = setTimeout(() => setTick({ dir: value > p ? "up" : "down", n: Date.now() }), 0);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span key={tick?.n} className={`${className ?? ""} ${tick ? (tick.dir === "up" ? "px-up" : "px-down") : ""}`}>
      {children}
    </span>
  );
}
