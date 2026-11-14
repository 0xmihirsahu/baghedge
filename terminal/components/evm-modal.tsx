"use client";

import { ArrowUpRight, Browser, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useConnect, useConnection, useConnectors, type Connector } from "wagmi";
import { BagLoader } from "@/components/motion";
import { haptic } from "@/lib/haptics";
import { CORAL } from "./app/format";
import { InlineError } from "./inline-error";

// the EVM wallet picker, drawn like the solana one: every wallet the browser announced (EIP-6963) with its own icon,
// a plain browser wallet if only window.ethereum is there, install rows when there's none, WalletConnect last.
// connecting hands the address back to whoever asked (a Trade or Hedge card)
const INSTALL = [
  { name: "MetaMask", icon: "/wallets/metamask.svg", url: "https://metamask.io/download", open: (u: string) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { name: "Rabby", icon: "/wallets/rabby.svg", url: "https://rabby.io", open: null },
  { name: "Coinbase Wallet", icon: "/wallets/coinbase.svg", url: "https://www.coinbase.com/wallet/downloads", open: (u: string) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
];

// wagmi and wallet errors in plain words: what happened, what to do
function reason(e: unknown) {
  const err = e as { name?: string; message?: string; code?: number; cause?: { code?: number } };
  const text = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (err?.code === 4001 || err?.cause?.code === 4001 || /reject|denied|cancel/i.test(text)) return "Cancelled in your wallet. Try again.";
  if (err?.code === -32002 || /already pending/i.test(text)) return "Your wallet has a request open. Check it.";
  if (/not found|provider/i.test(text)) return "Wallet not found. Unlock it and try again.";
  return "The wallet didn't connect. Try again.";
}

export function EvmModal({ open, title, onClose, onConnected }: { open: boolean; title: string; onClose: () => void; onConnected: (address: string) => void }) {
  const connectors = useConnectors();
  const connect = useConnect();
  const conn = useConnection();
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hasEthereum, setHasEthereum] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setHasEthereum(!!(window as unknown as { ethereum?: unknown }).ethereum);
      setPhone(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
      if (open) setFailed(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // named EIP-6963 wallets first; the generic injected entry only when none announced but window.ethereum exists
  const named = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = !named.length && hasEthereum ? connectors.filter((c) => c.type === "injected") : [];
  const wc = connectors.filter((c) => c.type === "walletConnect");
  const none = !named.length && !generic.length;

  const pick = async (c: Connector) => {
    haptic("tap");
    setPicked(c.uid);
    setFailed(null);
    try {
      const r = await connect.mutateAsync({ connector: c });
      const address = r.accounts[0];
      if (!address) throw new Error("no account");
      haptic("success");
      onConnected(address);
    } catch (e) {
      // already connected through this wallet: hand back the address we have
      if ((e as { name?: string })?.name === "ConnectorAlreadyConnectedError" && conn.address) {
        haptic("success");
        onConnected(conn.address);
      } else {
        haptic("error");
        setFailed(reason(e));
      }
    } finally {
      setPicked(null);
    }
  };

  const row = "flex h-14 items-center gap-3 rounded-[16px] px-3 text-left transition-colors duration-150 hover:bg-[#1c1b1a]";
  return (
    <div className={`fixed inset-0 z-[66] grid place-items-end bg-black/70 transition-opacity duration-200 sm:place-items-center ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden={!open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full rounded-t-[28px] bg-[#141312] p-5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-[392px] sm:rounded-[28px] sm:p-6 ${open ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[20px] font-semibold tracking-[-0.02em]">{title}</p>
          <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-[14px] text-white/45">
          {none ? (phone ? "Open baghedge inside a wallet app, or use WalletConnect." : "No browser wallet found. Install one, or use WalletConnect.") : "The EVM wallet that owns this Hyperliquid account. You sign every action."}
        </p>
        <div className="mt-5 flex flex-col gap-1">
          {[...named, ...generic, ...wc].map((c) => {
            const isWc = c.type === "walletConnect";
            return (
              <button key={c.uid} disabled={!!picked} onClick={() => pick(c)} className={`${row} active:scale-[0.99] disabled:opacity-60 disabled:hover:bg-transparent`}>
                {isWc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/wallets/walletconnect.svg" alt="" className="size-9 rounded-[10px]" />
                ) : c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="size-9 rounded-[10px]" />
                ) : (
                  <span className="grid size-9 place-items-center rounded-[10px] bg-[#2e2c2a]">
                    <Browser size={20} weight="fill" className="text-white" />
                  </span>
                )}
                <span className="text-[16px] font-semibold">{isWc ? "WalletConnect" : c.id === "injected" ? "Browser wallet" : c.name}</span>
                <span className="ml-auto text-[13px] text-white/45">{picked === c.uid ? <BagLoader size={18} color={CORAL} label="Connecting" /> : isWc ? "Phone" : "Detected"}</span>
              </button>
            );
          })}
          {none && <p className="mt-2 px-3 text-[12px] text-white/40">Get a wallet</p>}
          {none &&
            INSTALL.map((i) => {
              const href = phone && i.open ? i.open(location.href) : i.url;
              return (
                <a key={i.name} href={href} target={phone ? undefined : "_blank"} rel="noreferrer" onClick={() => haptic("tap")} className={row}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.icon} alt="" className="size-9 shrink-0 rounded-[10px]" />
                  <span className="text-[16px] font-semibold">{i.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-[13px] text-white/45">
                    {phone && i.open ? "Open" : "Install"} <ArrowUpRight size={14} />
                  </span>
                </a>
              );
            })}
        </div>
        <InlineError text={failed} align="center" className="mt-3" />
      </div>
    </div>
  );
}
