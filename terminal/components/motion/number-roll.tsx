"use client";

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./dots";

// a number that rolls from its old value to its new one instead of jumping: exposure, filled size, p&l, balances
export function NumberRoll({
  value,
  format = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 }),
  duration = 650,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (reducedMotion()) {
      from.current = value;
      const r = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(r);
    }
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const v = start + (value - start) * e;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }} aria-live="polite">
      {format(shown)}
    </span>
  );
}
