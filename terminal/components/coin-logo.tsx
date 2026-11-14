"use client";

import { useState } from "react";
import { logo } from "./app/format";

// a coin's logo, or its first letter when there's no icon for it (some coins have none on hyperliquid)
export function CoinLogo({ coin, className = "" }: { coin: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className={`grid shrink-0 place-items-center rounded-full bg-[#2e2c2a] text-[13px] font-semibold text-white/80 ${className}`} aria-hidden>
        {coin.replace(/^k/, "").slice(0, 1)}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logo(coin)} alt="" loading="lazy" onError={() => setFailed(true)} className={`shrink-0 rounded-full bg-[#1c1b1a] ${className}`} />;
}
