"use client";

import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BagLoader } from "@/components/motion";
import { useStore } from "./app/store";
import { CoinLogo } from "./coin-logo";
import { coinHref, compact, pct, priceDecimals, tone, usd } from "./app/format";

type Sort = "volume" | "change" | "funding" | "oi";
const COLS: { key: Sort; label: string }[] = [
  { key: "change", label: "24h" },
  { key: "volume", label: "Volume" },
  { key: "oi", label: "Open interest" },
  { key: "funding", label: "Funding" },
];

// every hyperliquid perp, live: price from the socket, the rest from a snapshot each minute
export function MarketsPage() {
  const { markets, mids } = useStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("volume");
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

  const rows = useMemo(() => {
    const list = markets
      .filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
      .map((m) => {
        const px = mids[m.name] ?? m.mark;
        return { ...m, px, change: m.prevDay ? px / m.prevDay - 1 : 0 };
      });
    return list.sort((a, b) => (sort === "change" ? Math.abs(b.change) - Math.abs(a.change) : b[sort] - a[sort]));
  }, [markets, mids, q, sort]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-7">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Markets</h1>
          <p className="text-[13px] text-white/45">{markets.length ? `${markets.length} perps on Hyperliquid` : " "}</p>
        </div>
        <label className="flex h-10 w-full items-center gap-2 rounded-[12px] bg-[#1c1b1a] px-3 sm:w-[280px]">
          <MagnifyingGlass size={16} className="text-white/45" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-white/35" />
          <kbd className="hidden rounded-[6px] bg-[#2e2c2a] px-1.5 text-[11px] text-white/50 sm:block">/</kbd>
        </label>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-y border-white/[0.08] px-5 py-2.5 text-[12px] text-white/45 sm:px-7 md:grid-cols-[minmax(0,1.4fr)_1fr_0.8fr_1fr_1fr_0.9fr]">
        <span>Market</span>
        <span className="text-right">Price</span>
        {COLS.map((c) => (
          <button key={c.key} onClick={() => setSort(c.key)} className={`hidden items-center justify-end gap-1 md:flex ${sort === c.key ? "text-white" : "hover:text-white/70"}`}>
            {c.label}
            {sort === c.key && <CaretDown size={10} weight="bold" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!markets.length ? (
          <div className="grid h-full place-items-center"><BagLoader size={44} label="Loading markets" /></div>
        ) : !rows.length ? (
          <p className="py-10 text-center text-[14px] text-white/45">No market called “{q}”</p>
        ) : (
          rows.map((m) => (
            <Link
              key={m.name}
              href={coinHref(m.name)}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 text-[14px] tabular-nums transition-colors duration-100 hover:bg-[#141312] sm:px-7 md:grid-cols-[minmax(0,1.4fr)_1fr_0.8fr_1fr_1fr_0.9fr]"
            >
              <span className="flex items-center gap-3">
                <CoinLogo coin={m.name} className="size-8" />
                <span className="font-semibold">{m.name}</span>
                <span className="rounded-[6px] bg-[#1c1b1a] px-1.5 py-0.5 text-[11px] text-white/55">{m.maxLeverage}x</span>
              </span>
              <span className="text-right leading-tight">
                <span className="block font-medium">{usd(m.px, priceDecimals(m.px, m.szDecimals))}</span>
                <span className="block text-[12px] md:hidden" style={{ color: tone(m.change) }}>{pct(m.change)}</span>
              </span>
              <span className="hidden text-right md:block" style={{ color: tone(m.change) }}>{pct(m.change)}</span>
              <span className="hidden text-right text-white/80 md:block">{compact(m.volume)}</span>
              <span className="hidden text-right text-white/80 md:block">{compact(m.oi)}</span>
              <span className="hidden text-right md:block" style={{ color: tone(m.funding) }}>{(m.funding * 100).toFixed(4)}%</span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
