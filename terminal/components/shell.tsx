"use client";

import { ChartBar, ClockCounterClockwise, Handbag, Wallet, X } from "@phosphor-icons/react";
import { WalletAvatar } from "./avatar";
import { CopyAddress } from "./copy-address";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoReveal, NumberRoll, StatusText } from "@/components/motion";
import { useStore } from "./app/store";
import { CoinLogo } from "./coin-logo";
import { COINS, DOWN, coinHref, pct, tone, usd } from "./app/format";
import { short } from "./app/wallet";

const NAV = [
  { href: "/markets", label: "Markets", icon: ChartBar },
  { href: "/", label: "Hedge", icon: Handbag },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/activity", label: "Activity", icon: ClockCounterClockwise },
];

const active = (path: string, href: string) => (href === "/" ? path === "/" || path === "/markets/SOL" : path === href || (href === "/markets" && path.startsWith("/markets/") && path !== "/markets/SOL"));

// the frame every page sits in: sidebar on desktop, top bar and tabs on a phone, toasts, the first-load splash
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { mids, markets, toasts } = useStore();
  const [splash, setSplash] = useState(true);
  const prev = Object.fromEntries(markets.map((m) => [m.name, m.prevDay]));

  return (
    <main className="grid h-svh overflow-hidden bg-[#0b0908] lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-white/[0.08] lg:flex">
        <div className="px-4 pb-4 pt-5">
          <Link href="/" className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mascot.webp" alt="" className="size-6" />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">baghedge</span>
          </Link>
          <nav className="mt-6 flex flex-col gap-1">
            {NAV.map((n) => {
              const on = active(path, n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`flex items-center gap-3 rounded-[12px] px-2 py-2 text-[15px] font-semibold transition-colors duration-150 ${on ? "text-white" : "text-white/55 hover:text-white"}`}>
                  <NavTile icon={n.icon} on={on} size={30} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-y border-white/[0.08] px-4 py-2">
          {COINS.map((c) => {
            const px = mids[c];
            const ch = px && prev[c] ? px / prev[c] - 1 : undefined;
            const on = path === coinHref(c) || path === `/markets/${c}`;
            return (
              <Link key={c} href={coinHref(c)} className={`flex items-center gap-3 rounded-[12px] px-2.5 py-2.5 transition-colors duration-150 ${on ? "bg-[#1c1b1a]" : "hover:bg-[#141312]"}`}>
                <CoinLogo coin={c} className="size-8" />
                <span className="text-[15px] font-semibold">{c}</span>
                <span className="ml-auto text-right leading-tight tabular-nums">
                  <span className="block text-[14px] font-medium">{px ? usd(px) : "…"}</span>
                  <span className="block text-[12px]" style={{ color: tone(ch) }}>{ch === undefined ? "" : pct(ch)}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <WalletBox />
      </aside>

      <div className="flex min-h-0 flex-col">
        {/* phone: logo and wallet on top, tabs at the bottom */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3 lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mascot.webp" alt="" className="size-6" />
            <span className="text-[17px] font-semibold tracking-[-0.03em]">baghedge</span>
          </Link>
          <WalletChip />
        </div>
        <div className="min-h-0 flex-1 pb-[124px] lg:pb-0">{children}</div>
        <nav className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-white/[0.08] bg-[#0b0908] lg:hidden">
          {NAV.map((n) => {
            const on = active(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${on ? "text-white" : "text-white/50"}`}>
                <NavTile icon={n.icon} on={on} size={28} />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* toasts size to their text and wrap: top-centre on a phone, top-right on desktop, never past the edge */}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:right-4 lg:items-end">
        {toasts.map((t) => (
          <div key={t.id} className="toast-in relative flex min-w-[220px] max-w-[min(360px,100%)] items-center gap-3 rounded-[14px] bg-[#1c1b1a] px-4 py-3">
            <span className="shrink-0 text-[13px] text-white/50">{t.kind === "replay" ? `Replay · ${t.title}` : t.title}</span>
            <StatusText text={t.status} className="min-w-0 break-words text-[15px] font-medium" />
            {t.kind === "error" && <span className="ml-auto size-2 shrink-0 rounded-full" style={{ background: DOWN }} />}
          </div>
        ))}
      </div>

      {splash && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0b0908]">
          <LogoReveal size={120} onDone={() => setTimeout(() => setSplash(false), 400)} />
        </div>
      )}
    </main>
  );
}

// connect a solana wallet or watch an address. we read the public balance, nothing else
export function WalletBox() {
  const { wallet } = useStore();
  const [addr, setAddr] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {wallet.address ? (
        <div className="flex items-center gap-3 px-1">
          <WalletAvatar address={wallet.address} size={36} />
          <div className="min-w-0 whitespace-nowrap text-[14px] leading-tight">
            <p className="font-semibold tabular-nums">{wallet.sol === null ? "…" : <NumberRoll value={wallet.sol} format={(n) => `${n.toFixed(2)} SOL`} />}</p>
            <CopyAddress address={wallet.address} prefix={wallet.connected ? undefined : "Watching"} />
          </div>
          <button onClick={wallet.forget} className="ml-auto text-white/40 transition-colors hover:text-white" aria-label="Disconnect"><X size={16} /></button>
        </div>
      ) : (
        <>
          <button onClick={wallet.connect} disabled={wallet.connecting} className="h-11 rounded-[12px] bg-[#f0645a] text-[15px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:opacity-70">
            {wallet.connecting ? "Connecting…" : "Connect wallet"}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!wallet.watch(addr)) setBad(true);
            }}
          >
            <input
              value={addr}
              onChange={(e) => {
                setAddr(e.target.value);
                setBad(false);
              }}
              placeholder="Or watch an address"
              aria-invalid={bad}
              className={`h-10 w-full rounded-[11px] bg-[#1c1b1a] px-3 text-[13px] outline-none ring-1 transition-shadow placeholder:text-white/35 ${bad ? "ring-[#f2554b]" : "ring-transparent focus:ring-white/15"}`}
            />
          </form>
        </>
      )}
    </div>
  );
}

function WalletChip() {
  const { wallet } = useStore();
  if (!wallet.address)
    return (
      <button onClick={wallet.connect} className="h-9 rounded-[11px] bg-[#f0645a] px-3.5 text-[14px] font-semibold">
        Connect wallet
      </button>
    );
  return (
    <Link href="/portfolio" className="flex items-center gap-2 rounded-[11px] bg-[#1c1b1a] py-1 pl-1 pr-3 text-[13px] font-semibold tabular-nums">
      <WalletAvatar address={wallet.address} size={26} />
      {wallet.sol === null ? short(wallet.address) : `${wallet.sol.toFixed(2)} SOL`}
    </Link>
  );
}

// an app-style nav icon: a filled phosphor glyph in a rounded tile. coral when you're on it
function NavTile({ icon: Icon, on, size }: { icon: typeof Wallet; on: boolean; size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[9px] transition-colors duration-150" style={{ width: size, height: size, background: on ? "#f0645a" : "#1c1b1a" }}>
      <Icon size={Math.round(size * 0.58)} weight="fill" color={on ? "#ffffff" : "rgba(255,255,255,0.7)"} />
    </span>
  );
}
