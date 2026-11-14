"use client";

import { CORAL, WHITE } from "./dots";

// section 11 of the brief in one row: the watched SOL as white dots, the hedged part turning coral.
// when the short is bigger than the wallet (a buyback is pending), the extra coral dots sit past the wallet, hollow
export function ExposureDots({
  watched,
  hedged,
  per = 0.5,
  size = 12,
  className,
}: {
  watched: number;
  hedged: number;
  per?: number;
  size?: number;
  className?: string;
}) {
  const own = Math.round(watched / per);
  const cover = Math.round(Math.abs(hedged) / per);
  const total = Math.max(own, cover);
  const gap = size * 0.5;
  return (
    <div className={className} style={{ display: "flex", flexWrap: "wrap", gap }} role="img" aria-label={`${watched} SOL watched, ${Math.abs(hedged)} SOL hedged`}>
      {Array.from({ length: total }, (_, i) => {
        const inWallet = i < own;
        const isHedged = i < cover;
        // the hedge fills from the right of the wallet, so the unhedged SOL stays on the left
        const fromRight = own - 1 - i;
        const hedgedHere = inWallet ? fromRight < cover : isHedged;
        const over = !inWallet && isHedged;
        return (
          <span
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              boxSizing: "border-box",
              background: over ? "transparent" : hedgedHere ? CORAL : WHITE,
              border: over ? `2px solid ${CORAL}` : "none",
              opacity: inWallet || over ? 1 : 0,
              transform: inWallet || over ? "scale(1)" : "scale(0.4)",
              transition: `background-color 400ms ease ${Math.abs(fromRight) * 25}ms, transform 400ms ease, opacity 300ms ease`,
            }}
          />
        );
      })}
    </div>
  );
}
