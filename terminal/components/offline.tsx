"use client";

import { useEffect, useState } from "react";

// a calm "can't reach it" state for a card: the unplugged halftone art (codex, the landing's style), a title, one line
export function Offline({ title = "Couldn't reach Hyperliquid", line = "Retrying on its own.", compact = false }: { title?: string; line?: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className="inline-error-in flex flex-col items-center px-4 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/no-connection.webp" alt="" className={`h-auto max-w-full ${compact ? "w-[180px]" : "w-[240px]"}`} />
      <p className={`${compact ? "mt-4" : "mt-6"} text-[15px] font-semibold`}>{title}</p>
      <p className="mt-1 text-[13px] text-white/45">{line}</p>
    </div>
  );
}

// true once `on` has held for `ms`, so a normal slow load never flashes an error state
export function useAfter(on: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      const t = setTimeout(() => setLate(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}
