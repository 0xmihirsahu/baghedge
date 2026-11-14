"use client";

import Avatar from "boring-avatars";
import Link from "next/link";
import { useState } from "react";
import { BagLoader, ExposureDots, NumberRoll, StatusText } from "@/components/motion";
import { useAccount } from "./app/hl";
import { CoinLogo } from "./coin-logo";
import { STATUS, useStore } from "./app/store";
import { CORAL, compact, tone, usd } from "./app/format";
import { isEvmAddress, short } from "./app/wallet";
import { WalletBox } from "./shell";

const AVATAR = [CORAL, "#0b0908", "#2e2c2a", "#ffffff"];

// three parts: the watched SOL, the hedge on it, and the two hyperliquid accounts (Trade and Hedge)
export function PortfolioPage() {
  const { wallet, mids, hedge: h, accounts, setAccounts } = useStore();
  const mark = mids.SOL;

  return (
    <section className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1180px] gap-4 p-5 sm:p-7 xl:grid-cols-[1fr_1fr]">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] xl:col-span-2">Portfolio</h1>

        {/* the watched wallet */}
        <div className="rounded-[20px] bg-[#141312] p-6">
          <p className="text-[13px] text-white/45">Wallet</p>
          {wallet.address ? (
            <>
              <div className="mt-4 flex items-center gap-3">
                <Avatar name={wallet.address} variant="marble" size={44} colors={AVATAR} />
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold">{wallet.connected ? wallet.name : "Watching"}</p>
                  <p className="text-[13px] text-white/45">{short(wallet.address)}</p>
                </div>
              </div>
              <p className="mt-6 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {wallet.sol === null ? <BagLoader size={30} label="Reading balance" /> : <NumberRoll value={wallet.sol} format={(n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`} />}
              </p>
              <p className="mt-2 text-[14px] text-white/45 tabular-nums">{wallet.sol !== null && mark ? usd(wallet.sol * mark) : " "}</p>
            </>
          ) : (
            <div className="-mx-4 mt-2 max-w-[320px]">
              <WalletBox />
            </div>
          )}
        </div>

        {/* the hedge on it */}
        <div className="flex flex-col rounded-[20px] bg-[#141312] p-6">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/45">Hedge</p>
            <span className="rounded-[7px] bg-[#1c1b1a] px-2 py-0.5 text-[12px] text-white/55">Replay</span>
          </div>
          <StatusText text={STATUS[h.phase]} className="mt-4 block text-[15px] font-semibold" />
          <p className="mt-6 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            <NumberRoll value={h.hedge} format={(n) => `${n.toFixed(2)} SOL`} />
          </p>
          <p className="mt-2 text-[14px] text-white/45 tabular-nums">
            Entry {usd(h.entry)} · Recovery {usd(h.recovery)}
          </p>
          {h.held > 0 && <ExposureDots watched={h.held} hedged={h.hedge} per={h.held / 20} size={12} className="mt-5 w-[174px]" />}
          <Link href="/" className="mt-auto pt-6 text-[14px] font-semibold text-white/70 hover:text-white">
            {h.phase === "draft" ? "Set up a hedge" : "Open the hedge"}
          </Link>
        </div>

        <Account role="trade" label="Trade account" address={accounts.trade} other={accounts.hedge} onSet={(a) => setAccounts({ ...accounts, trade: a })} />
        <Account role="hedge" label="Hedge account" address={accounts.hedge} other={accounts.trade} onSet={(a) => setAccounts({ ...accounts, hedge: a })} />
      </div>
    </section>
  );
}

// a hyperliquid master account by public address: equity and open positions, mainnet
function Account({ label, address, other, onSet }: { role: string; label: string; address: string; other: string; onSet: (a: string) => void }) {
  const { account, error } = useAccount(address || null);
  const [input, setInput] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  return (
    <div className="flex min-h-[260px] flex-col rounded-[20px] bg-[#141312] p-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-white/45">{label}</p>
        {address && (
          <button onClick={() => onSet("")} className="text-[12px] text-white/45 hover:text-white">
            {short(address)} · Remove
          </button>
        )}
      </div>

      {!address ? (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const a = input.trim();
            if (!isEvmAddress(a)) return setBad("Not a Hyperliquid address");
            if (other && a.toLowerCase() === other.toLowerCase()) return setBad("Trade and Hedge must differ");
            onSet(a);
          }}
        >
          <p className="text-[14px] text-white/70">Add the account&apos;s address to see its equity and positions.</p>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setBad(null);
            }}
            placeholder="0x…"
            aria-invalid={!!bad}
            className={`mt-2 h-11 rounded-[12px] bg-[#1c1b1a] px-3 text-[14px] outline-none ring-1 placeholder:text-white/35 ${bad ? "ring-[#f2554b]" : "ring-transparent focus:ring-white/15"}`}
          />
          <p className="h-4 text-[12px] text-[#f2554b]">{bad}</p>
          <button className="h-11 w-max rounded-[12px] bg-[#1c1b1a] px-4 text-[14px] font-semibold hover:bg-[#2e2c2a]">Add</button>
        </form>
      ) : error && !account ? (
        <p className="mt-6 text-[14px] text-white/55">Couldn&apos;t reach Hyperliquid. Retrying.</p>
      ) : !account ? (
        <div className="grid flex-1 place-items-center"><BagLoader size={32} label="Reading account" /></div>
      ) : (
        <>
          <div className="mt-4 flex items-end gap-6">
            <div>
              <p className="text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{usd(account.equity, 2)}</p>
              <p className="mt-2 text-[13px] text-white/45">Equity · {usd(account.withdrawable, 2)} withdrawable</p>
            </div>
          </div>
          <div className="mt-5 border-t border-white/[0.08]">
            {account.positions.length ? (
              account.positions.map((p) => (
                <Link key={p.coin} href={p.coin === "SOL" ? "/" : `/markets/${p.coin}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                  <CoinLogo coin={p.coin} className="size-8" />
                  <div className="leading-tight">
                    <p className="text-[14px] font-semibold">
                      {p.coin} <span className="font-normal" style={{ color: tone(p.size) }}>{p.size < 0 ? "Short" : "Long"} {p.leverage}x</span>
                    </p>
                    <p className="text-[12px] text-white/45 tabular-nums">
                      {Math.abs(p.size)} at {usd(p.entry)}
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
              <p className="py-6 text-center text-[14px] text-white/45">No open positions</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
