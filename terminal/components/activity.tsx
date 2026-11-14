"use client";

import Link from "next/link";
import { useAccount } from "./app/hl";
import { useStore } from "./app/store";
import { CoinLogo } from "./coin-logo";
import { Tip } from "./tip";
import { DOWN, UP, time, tone, usd } from "./app/format";
import { haptic } from "@/lib/haptics";
import { Offline } from "./offline";

// one list: the hedge replay's events and real fills from the Trade and Hedge accounts, newest first.
// every row says what it is, replay or mainnet (AGENTS.md rule 15)
export function ActivityPage() {
  const { activity, accounts } = useStore();
  const tradeRead = useAccount(accounts.trade || null);
  const hedgeRead = useAccount(accounts.hedge || null);
  const trade = tradeRead.account;
  const hedge = hedgeRead.account;
  // a read failed: fills may be missing. a quiet note in the subtitle's own line, so nothing moves
  const failing = (!!accounts.trade && tradeRead.error) || (!!accounts.hedge && hedgeRead.error);

  type Row = { at: number; key: string; coin: string; what: string; detail: string; tag: string; color?: string; pnl?: number };
  const rows: Row[] = [
    ...activity.map((a, i) => ({ at: a.at, key: `r${i}${a.at}`, coin: "SOL", what: a.what, detail: "", tag: "Replay" })),
    ...[
      ["Trade", trade],
      ["Hedge", hedge],
    ].flatMap(([name, acc]) =>
      ((acc as typeof trade)?.fills ?? []).map((f) => ({
        at: f.time,
        key: `${name}${f.tid}`,
        coin: f.coin,
        what: `${f.dir} ${f.coin}`,
        detail: `${f.sz} at ${usd(f.px)} · ${name} account`,
        tag: "Mainnet",
        color: f.side === "B" ? UP : DOWN,
        pnl: f.pnl || undefined,
      })),
    ),
  ].sort((a, b) => b.at - a.at);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="px-5 pb-4 pt-5 sm:px-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Activity</h1>
        <p className="truncate text-[13px] text-white/45">
          {failing && rows.length ? <span className="inline-error-in">Couldn&apos;t reach Hyperliquid. Fills may be missing. Retrying.</span> : "Hedge events and fills from your Hyperliquid accounts"}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.08]">
        {rows.length ? (
          rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-3 px-5 py-3 sm:px-7">
              <CoinLogo coin={r.coin} className="size-8" />
              <div className="min-w-0 leading-tight">
                <p className="text-[14px] font-semibold" style={{ color: r.color }}>{r.what}</p>
                <p className="truncate text-[12px] text-white/45 tabular-nums">{r.detail || "Hedge account"}</p>
              </div>
              <div className="ml-auto flex items-center gap-4 text-right tabular-nums">
                {r.pnl !== undefined && <span className="text-[13px]" style={{ color: tone(r.pnl) }}>{usd(r.pnl, 2)}</span>}
                <span className="hidden rounded-[6px] bg-[#1c1b1a] px-1.5 py-0.5 text-[11px] text-white/55 sm:block">
                  <Tip text={TAGS[r.tag]} side={i ? "top" : "bottom"} align="end">{r.tag}</Tip>
                </span>
                <span className="w-[64px] text-[13px] text-white/40">{time(r.at)}</span>
              </div>
            </div>
          ))
        ) : failing && !trade && !hedge ? (
          <div className="grid h-full min-h-[280px] place-items-center">
            <Offline line="Your fills show here once it answers." />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[15px] text-white/55">Nothing yet</p>
            <div className="flex gap-2">
              <Link href="/" onClick={() => haptic("select")} className="rounded-[12px] bg-[#1c1b1a] px-4 py-2.5 text-[14px] font-semibold hover:bg-[#2e2c2a]">Set up a hedge</Link>
              <Link href="/portfolio" onClick={() => haptic("select")} className="rounded-[12px] bg-[#1c1b1a] px-4 py-2.5 text-[14px] font-semibold hover:bg-[#2e2c2a]">Add an account</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// the first row's tag opens downward so the list never clips it
const TAGS: Record<string, string> = {
  Replay: "Simulated hedge event. Nothing was signed.",
  Mainnet: "A real fill from that Hyperliquid account.",
};
