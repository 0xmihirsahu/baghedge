"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { BagLoader } from "@/components/motion";
import { CORAL } from "./app/format";

// the EVM wallet picker, drawn like the solana one: every injected wallet the browser announced (EIP-6963),
// then WalletConnect for phones. connecting hands the address back to whoever asked (a Trade or Hedge card)
export function EvmModal({ open, title, onClose, onConnected }: { open: boolean; title: string; onClose: () => void; onConnected: (address: string) => void }) {
  const connectors = useConnectors();
  const connect = useConnect();
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hasEthereum, setHasEthereum] = useState(false);
  useEffect(() => {
    setTimeout(() => setHasEthereum(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // a named wallet hides the generic "Injected" entry; WalletConnect always last
  const named = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const list: Connector[] = [...(named.length ? named : connectors.filter((c) => c.type === "injected")), ...connectors.filter((c) => c.type === "walletConnect")];

  const pick = async (c: Connector) => {
    setPicked(c.uid);
    setFailed(false);
    try {
      const r = await connect.mutateAsync({ connector: c });
      const address = r.accounts[0];
      if (address) onConnected(address);
    } catch {
      setFailed(true);
    } finally {
      setPicked(null);
    }
  };

  return (
    <div className={`fixed inset-0 z-[66] grid place-items-end bg-black/70 transition-opacity duration-200 sm:place-items-center ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden={!open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full rounded-t-[28px] bg-[#141312] p-5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-[392px] sm:rounded-[28px] sm:p-6 ${open ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[20px] font-semibold tracking-[-0.02em]">{title}</p>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-[14px] text-white/45">The EVM wallet that owns this Hyperliquid account. You sign every action; we never hold keys.</p>
        <div className="mt-5 flex flex-col gap-1">
          {list.map((c) => (
            <button
              key={c.uid}
              disabled={!!picked}
              onClick={() => pick(c)}
              className="flex h-14 items-center gap-3 rounded-[16px] px-3 text-left transition-colors duration-150 hover:bg-[#1c1b1a] disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" className="size-9 rounded-[10px]" />
              ) : (
                <span className="grid size-9 place-items-center rounded-[10px] bg-[#2e2c2a] text-[13px] font-semibold">{c.type === "walletConnect" ? "WC" : c.name.slice(0, 1)}</span>
              )}
              <span className="text-[16px] font-semibold">{c.type === "walletConnect" ? "WalletConnect" : c.id === "injected" ? "Browser wallet" : c.name}</span>
              <span className="ml-auto text-[13px] text-white/45">
                {picked === c.uid ? <BagLoader size={18} color={CORAL} label="Connecting" /> : c.type === "walletConnect" ? "Phone" : c.id === "injected" && !hasEthereum ? "Not found" : "Detected"}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 h-4 text-center text-[12px] text-[#f2554b]">{failed ? "The wallet didn't connect" : ""}</p>
      </div>
    </div>
  );
}
