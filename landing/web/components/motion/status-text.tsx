"use client";

import { useEffect, useRef, useState } from "react";
import { GLYPHS, reducedMotion } from "./dots";

// labels from section 12 of the brief that mean something needs attention. they decode into coral
const WARN = new Set(["Recovery stop missing", "Close blocked", "Missed entry", "Resize blocked", "Incomplete deposit", "Failed", "Rejected", "Paused", "Checking recovery stop"]);

// a status label that decodes through glyphs into its new value, left to right, whenever `text` changes.
// for hedge states: "Awaiting signature", "Credited", "Armed", "Entry pending", "Recovery stop active"
export function StatusText({
  text,
  duration = 420,
  tone,
  className,
}: {
  text: string;
  duration?: number;
  tone?: "warn" | "plain";
  className?: string;
}) {
  const warn = tone ? tone === "warn" : WARN.has(text);
  const [shown, setShown] = useState(text);
  const first = useRef(true);

  useEffect(() => {
    if (first.current || reducedMotion()) {
      first.current = false;
      setShown(text);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const keep = Math.floor(t * text.length);
      setShown(
        Array.from(text, (ch, i) => (ch === " " || i < keep ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(""),
      );
      if (t < 1) raf = requestAnimationFrame(frame);
      else setShown(text);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);

  // screen readers get the real value at once, the scramble is decoration
  return (
    <span className={className} aria-live="polite">
      <span aria-hidden style={{ color: warn ? "#f0645a" : undefined, transition: "color 300ms ease" }}>
        {shown}
      </span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{text}</span>
    </span>
  );
}
