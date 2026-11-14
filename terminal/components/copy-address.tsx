"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { short } from "./app/wallet";
import { haptic } from "@/lib/haptics";

// the short address with a copy button. copies the full address, says so for a moment (or that it couldn't)
export function CopyAddress({ address, prefix, className = "" }: { address: string; prefix?: string; className?: string }) {
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  const show = (v: "copied" | "failed") => {
    haptic(v === "copied" ? "success" : "error");
    setDone(v);
    setTimeout(() => setDone(null), 1400);
  };
  return (
    <button
      type="button"
      onClick={() => {
        if (!navigator.clipboard?.writeText) return show("failed");
        navigator.clipboard.writeText(address).then(
          () => show("copied"),
          () => show("failed"),
        );
      }}
      title="Copy address"
      aria-label={done === "copied" ? "Address copied" : done === "failed" ? "Couldn't copy" : `Copy address ${address}`}
      className={`group inline-flex items-center gap-1.5 whitespace-nowrap text-white/45 transition-colors duration-150 hover:text-white ${className}`}
    >
      <span className={`tabular-nums ${done === "failed" ? "text-[#f2554b]" : ""}`}>{done === "copied" ? "Copied" : done === "failed" ? "Can't copy" : `${prefix ? `${prefix} ` : ""}${short(address)}`}</span>
      {done === "copied" ? <Check size={13} weight="bold" className="text-[#3ecf8e]" /> : <Copy size={13} className="opacity-70 group-hover:opacity-100" />}
    </button>
  );
}
