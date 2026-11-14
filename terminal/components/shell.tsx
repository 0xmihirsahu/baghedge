"use client";

import { ChartBar, ClockCounterClockwise, Handbag, Wallet, X } from "@phosphor-icons/react";
import { WalletAvatar } from "./avatar";
import { CopyAddress } from "./copy-address";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoReveal, NumberRoll, StatusText } from "@/components/motion";
import { useStore } from "./app/store";
import { Tip } from "./tip";
import { CoinLogo } from "./coin-logo";
import { COINS, DOWN, coinHref, pct, tone, usd } from "./app/format";
import { short } from "./app/wallet";
import { haptic } from "@/lib/haptics";

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
  // an error toast (a wallet connect cancelled or failed, a balance that won't read) buzzes once when it lands
  const buzzed = useRef(new Set<number>());
  useEffect(() => {
    for (const t of toasts) {
      if (buzzed.current.has(t.id)) continue;
      buzzed.current.add(t.id);
      if (t.kind === "error") haptic("error");
    }
  }, [toasts]);
  const tap = (on: boolean) => () => !on && haptic("select");

  return (
    <main className="grid h-svh overflow-hidden bg-[#0b0908] lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-white/[0.08] lg:flex">
        <div className="px-4 pb-4 pt-5">
          <Link href="/" className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mascot.webp" alt="" className="size-6" />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">baghedge</span>
            <span className="ml-auto"><Network /></span>
          </Link>
          <nav className="mt-6 flex flex-col gap-1">
            {NAV.map((n) => {
              const on = active(path, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  onClick={tap(on)}
                  className={`group relative flex items-center gap-3 rounded-[12px] px-2 py-2 text-[15px] font-semibold transition-colors duration-150 ${on ? "text-white" : "text-white/55 hover:text-white"}`}
                >
                  <NavTile icon={n.icon} on={on} size={30} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-y border-white/[0.08] px-4 py-2">
          {COINS.filter((c) => !markets.length || markets.some((m) => m.name === c)).map((c) => {
            const px = mids[c];
            const ch = px && prev[c] ? px / prev[c] - 1 : undefined;
            const on = path === coinHref(c) || path === `/markets/${c}`;
            return (
              <Link key={c} href={coinHref(c)} onClick={tap(on)} className={`flex items-center gap-3 rounded-[12px] px-2.5 py-2.5 transition-colors duration-150 ${on ? "bg-[#1c1b1a]" : "hover:bg-[#141312]"}`}>
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
            <Network align="start" />
          </Link>
          <WalletChip />
        </div>
        <div className="min-h-0 flex-1 pb-[124px] lg:pb-0">{children}</div>
        <nav className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-white/[0.08] bg-[#0b0908] lg:hidden">
          {NAV.map((n) => {
            const on = active(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} onClick={tap(on)} className={`group flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${on ? "text-white" : "text-white/50"}`}>
                <NavTile icon={n.icon} on={on} size={28} />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* toasts size to their text and wrap: top-centre on a phone, top-right on desktop, never past the edge */}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[68] flex flex-col items-center gap-2 lg:inset-x-auto lg:right-4 lg:items-end">
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
  const { wallet, privy } = useStore();
  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {/* who's signed in (Privy), above the SOL wallet they watch */}
      {privy?.authenticated && (
        <div className="flex items-center gap-2 px-1 text-[12px] text-white/45">
          <span className="min-w-0 truncate">{privy.label ?? "Signed in"}</span>
          <button
            onClick={() => {
              haptic("tap");
              privy.logout();
            }}
            className="ml-auto shrink-0 font-semibold text-white/55 transition-colors hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
      {/* the two Hyperliquid accounts that came with the sign-in */}
      {privy?.authenticated && (
        <div className="flex flex-col gap-1 rounded-[12px] bg-[#1c1b1a] px-3 py-2.5 text-[12px]">
          {(["trade", "hedge"] as const).map((r) => (
            <div key={r} className="flex items-center justify-between gap-2">
              <Tip text={r === "trade" ? "Your Hyperliquid account for trading by hand." : "A separate Hyperliquid account that holds the hedge."} side="top" align="start">
                <span className="text-white/45">{r === "trade" ? "Trade" : "Hedge"}</span>
              </Tip>
              {privy[r] ? <CopyAddress address={privy[r]!} /> : <span className="text-white/35">{privy.error ? "Not set up" : "Setting up…"}</span>}
            </div>
          ))}
        </div>
      )}
      {wallet.address ? (
        <div className="flex items-center gap-3 px-1">
          <WalletAvatar address={wallet.address} size={36} />
          <div className="min-w-0 whitespace-nowrap text-[14px] leading-tight">
            <p className="font-semibold tabular-nums">{wallet.sol === null ? "…" : <NumberRoll value={wallet.sol} format={(n) => `${n.toFixed(2)} SOL`} />}</p>
            <CopyAddress address={wallet.address} />
          </div>
          <button
            onClick={() => {
              haptic("tap");
              wallet.forget();
            }}
            className="ml-auto text-white/40 transition-colors hover:text-white" aria-label={wallet.connected ? "Disconnect" : "Stop watching"} title={wallet.connected ? "Disconnect" : "Stop watching"}><X size={16} /></button>
        </div>
      ) : (
        <button
          onClick={() => {
            haptic("tap");
            wallet.connect();
          }}
          disabled={wallet.connecting}
          className="h-11 rounded-[12px] bg-[#f0645a] text-[15px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:opacity-70">
          {wallet.connecting ? "Connecting…" : privy && !privy.authenticated ? "Sign in" : privy ? "Add your SOL" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}

function WalletChip() {
  const { wallet, privy } = useStore();
  if (!wallet.address)
    return (
      <button
        onClick={() => {
          haptic("tap");
          wallet.connect();
        }}
        disabled={wallet.connecting}
        className="h-9 rounded-[11px] bg-[#f0645a] px-3.5 text-[14px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:opacity-70"
      >
        {wallet.connecting ? "Connecting…" : privy && !privy.authenticated ? "Sign in" : privy ? "Add your SOL" : "Connect wallet"}
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
// a nav tile. on hover, coral halftone dots rise through it row by row from the bottom: a 6×6 grid of
// whole dots inset from the edge, corners left out so it follows the rounded tile and nothing is cut.
// active is solid coral. press sinks it a touch
const DOTS = Array.from({ length: 36 }, (_, i) => ({ r: Math.floor(i / 6), c: i % 6 })).filter(({ r, c }) => !((r === 0 || r === 5) && (c === 0 || c === 5)));

function NavTile({ icon: Icon, on, size }: { icon: typeof Wallet; on: boolean; size: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-[9px] transition-[scale] duration-150 ease-out group-active:scale-[0.94]" style={{ width: size, height: size, background: on ? "#f0645a" : "#1c1b1a" }}>
      {!on && (
        <svg viewBox="0 0 24 24" className="absolute inset-[5%]" aria-hidden>
          {DOTS.map(({ r, c }) => (
            <circle
              key={`${r}${c}`}
              cx={2 + c * 4}
              cy={2 + r * 4}
              r={1.25}
              fill="#f0645a"
              className="origin-center scale-50 opacity-0 transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] [transform-box:fill-box] group-hover:scale-100 group-hover:opacity-100 motion-reduce:transition-none"
              style={{ transitionDelay: `${(5 - r) * 25}ms` }}
            />
          ))}
        </svg>
      )}
      <Icon size={Math.round(size * 0.58)} weight="fill" className={`relative transition-colors duration-150 ${on ? "text-white" : "text-white/70 group-hover:text-white"}`} />
    </span>
  );
}

// which network the backend runs, and who signs hedge orders (AGENTS.md rule 15: every claim says what it is)
// the tip opens toward free space: leftward in the sidebar, rightward in the phone header (never past the screen edge)
function Network({ align = "end" }: { align?: "start" | "end" }) {
  const { backend } = useStore();
  const label = !backend.reachable ? "Read only" : backend.mode === "testnet" ? "Testnet" : "Mainnet";
  const behind = backend.reachable && backend.apiMode !== backend.mode;
  const tip = !backend.reachable
    ? "Backend unreachable. Prices are live; hedges run as a replay."
    : behind
      ? `Live ${backend.mode} prices. Hedges run as a replay until the baghedge backend moves to ${backend.mode}.`
      : backend.signer === "fallback"
      ? `Hyperliquid ${backend.mode}. Hedge orders are signed by a labelled demo key, not the attested guard yet.`
      : `Hyperliquid ${backend.mode}. Hedge orders are signed by the attested guard on NEAR.`;
  return (
    // nowrap sits on the label only: on the wrapper it would leak into the tip and stretch it past the screen
    <span className="shrink-0 rounded-[7px] bg-[#1c1b1a] px-2 py-0.5 text-[11px] font-semibold text-white/70">
      <Tip text={tip} side="bottom" align={align}>
        <span className="whitespace-nowrap">
          {label}
          {behind ? " · Replay" : backend.reachable && backend.signer === "fallback" ? " · Demo" : ""}
        </span>
      </Tip>
    </span>
  );
}
