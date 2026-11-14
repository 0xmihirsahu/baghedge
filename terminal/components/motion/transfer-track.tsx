"use client";

import { CORAL, WHITE, reducedMotion } from "./dots";
import { StatusText } from "./status-text";

const STEPS = ["Awaiting signature", "Deposit detected", "In transit", "Credited"];

// the funding states from the brief as a track: Base on one end, Hyperliquid on the other.
// coral dots travel along the dotted path while the deposit is in transit, and the label decodes at each step
export function TransferTrack({
  step,
  from = "Base",
  to = "Hyperliquid",
  amount,
  className,
}: {
  step: number;
  from?: string;
  to?: string;
  amount?: string;
  className?: string;
}) {
  const moving = step === 2 && !reducedMotion();
  const done = step >= 3;
  return (
    <div className={className}>
      <style>{`@keyframes bh-travel { from { left: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } to { left: calc(100% - 8px); opacity: 0; } }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
        <span style={{ color: WHITE }}>{from}</span>
        <div style={{ position: "relative", flex: 1, height: 14 }}>
          {/* the path, white dots that turn coral behind the deposit */}
          <div
            style={{
              position: "absolute",
              inset: "5px 0",
              backgroundImage: `radial-gradient(circle, ${done ? CORAL : "rgba(255,255,255,0.35)"} 2px, transparent 2.5px)`,
              backgroundSize: "10px 4px",
              transition: "all 500ms ease",
            }}
          />
          {moving &&
            [0, 1, 2].map((k) => (
              <span
                key={k}
                style={{
                  position: "absolute",
                  top: 3,
                  left: 0,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: CORAL,
                  animation: `bh-travel 1.6s cubic-bezier(0.65,0,0.35,1) ${k * 0.25}s infinite`,
                }}
              />
            ))}
          {!moving && (
            <span
              style={{
                position: "absolute",
                top: 3,
                left: done ? "calc(100% - 8px)" : step >= 1 ? "6%" : 0,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: step >= 1 ? CORAL : "rgba(255,255,255,0.5)",
                transition: "left 600ms cubic-bezier(0.16,1,0.3,1), background-color 300ms ease",
              }}
            />
          )}
        </div>
        <span style={{ color: done ? CORAL : WHITE, transition: "color 400ms ease" }}>{to}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 14 }}>
        <StatusText text={STEPS[Math.min(step, 3)]} />
        {amount && <span style={{ opacity: 0.6 }}>{amount}</span>}
      </div>
    </div>
  );
}
