"use client";

import { ArrowUpRight, X } from "@phosphor-icons/react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { BagLoader } from "@/components/motion";
import { CORAL } from "./app/format";

// our wallet picker over solana wallet adapter: the adapter finds and connects wallets, this draws them.
// edge cases: nothing installed (install links), a phone with no wallet (open the app inside one),
// a wallet mid-connect (loader, the rest wait), a rejection (the store turns it into a toast)
const INSTALL = [
  { name: "Phantom", icon: "/wallets/phantom.svg", bg: "#ab9ff2", pad: "p-1.5", white: true, url: "https://phantom.com/download", open: (u: string) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: "Solflare", icon: "/wallets/solflare.svg", bg: "#ffef46", pad: "p-0", white: false, url: "https://solflare.com/download", open: (u: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: "Backpack", icon: "/wallets/backpack.png", bg: "#1c1b1a", pad: "p-1.5", white: false, url: "https://backpack.app/download", open: null },
];

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select, wallet, connecting, connected } = useWallet();
  const [picked, setPicked] = useState<string | null>(null);
  const ready = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const [phone, setPhone] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setTimeout(() => {
      setPhone(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
      setMounted(true);
    }, 0);
  }, []);

  // close once a wallet is connected, and on escape
  useEffect(() => {
    if (open && connected) onClose();
  }, [open, connected, onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // a cancelled connect clears the loader
  useEffect(() => {
    if (!connecting && !connected) setTimeout(() => setPicked(null), 0);
  }, [connecting, connected]);

  const missing = INSTALL.filter((i) => !ready.some((w) => w.adapter.name === i.name));
  if (!mounted) return null;

  return (
    <div className={`fixed inset-0 z-[65] grid place-items-end bg-black/70 transition-opacity duration-200 sm:place-items-center ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden={!open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        className={`w-full rounded-t-[24px] bg-[#141312] p-5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-[400px] sm:rounded-[24px] sm:p-6 ${open ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[20px] font-semibold tracking-[-0.02em]">Connect wallet</p>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="mt-1 text-[14px] text-white/45">We read your SOL balance. Nothing moves without your signature.</p>

        <div className="mt-5 flex flex-col gap-1">
          {ready.map((w) => {
            const busy = connecting && (picked === w.adapter.name || wallet?.adapter.name === w.adapter.name);
            return (
              <button
                key={w.adapter.name}
                disabled={connecting}
                onClick={() => {
                  setPicked(w.adapter.name);
                  select(w.adapter.name as WalletName);
                }}
                className="flex h-14 items-center gap-3 rounded-[14px] px-3 text-left transition-colors duration-150 hover:bg-[#1c1b1a] disabled:opacity-60 disabled:hover:bg-transparent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="size-9 rounded-[10px]" />
                <span className="text-[16px] font-semibold">{w.adapter.name}</span>
                <span className="ml-auto text-[13px] text-white/45">{busy ? <BagLoader size={18} color={CORAL} label="Connecting" /> : "Detected"}</span>
              </button>
            );
          })}
        </div>

        {missing.length > 0 && (
          <>
            <p className="mb-1 mt-4 px-3 text-[12px] text-white/40">{ready.length ? "More wallets" : phone ? "Open baghedge in a wallet" : "Get a Solana wallet"}</p>
            <div className="flex flex-col gap-1">
              {missing.map((i) => {
                const href = phone && i.open ? i.open(location.href) : i.url;
                return (
                  <a key={i.name} href={href} target={phone ? undefined : "_blank"} rel="noreferrer" className="flex h-14 items-center gap-3 rounded-[14px] px-3 transition-colors duration-150 hover:bg-[#1c1b1a]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <span className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-[10px] ${i.pad}`} style={{ background: i.bg }}><img src={i.icon} alt="" className="size-full object-contain" style={{ filter: i.white ? "brightness(0) invert(1)" : undefined }} /></span>
                    <span className="text-[16px] font-semibold">{i.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-[13px] text-white/45">
                      {phone && i.open ? "Open" : "Install"} <ArrowUpRight size={14} />
                    </span>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
