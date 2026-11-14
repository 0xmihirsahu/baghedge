"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { short } from "./app/wallet";

// the short address with a copy button. copies the full address, says so for a moment
export function CopyAddress({ address, prefix, className = "" }: { address: string; prefix?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(address).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => {},
        );
      }}
      title="Copy address"
      aria-label={done ? "Address copied" : `Copy address ${address}`}
      className={`group inline-flex items-center gap-1.5 text-white/45 transition-colors duration-150 hover:text-white ${className}`}
    >
      <span className="tabular-nums">{done ? "Copied" : `${prefix ? `${prefix} ` : ""}${short(address)}`}</span>
      {done ? <Check size={13} weight="bold" className="text-[#3ecf8e]" /> : <Copy size={13} className="opacity-70 group-hover:opacity-100" />}
    </button>
  );
}
