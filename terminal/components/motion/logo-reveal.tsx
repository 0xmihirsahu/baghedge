"use client";

import { useEffect, useRef, useState } from "react";
import { CORAL, WHITE, drawMark, fit, hash, markGrid, reducedMotion } from "./dots";

const out = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// the splash: the mark decodes in from glyphs left to right, then the name slides out from behind it.
// change `play` (any new value) to run it again. onDone fires once the name has landed
export function LogoReveal({
  size = 96,
  name = true,
  play = 0,
  color = CORAL,
  glyph = WHITE,
  onDone,
  className,
}: {
  size?: number;
  name?: boolean;
  play?: number;
  color?: string;
  glyph?: string;
  onDone?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const el = ref.current!;
    const g = markGrid(size);
    const h = size, w = Math.round((size * g.cols) / g.rows);
    const ctx = fit(el, w, h);
    const still = reducedMotion();
    const DUR = still ? 0 : 900, WIPE = 0.14;
    const thr = Float32Array.from({ length: g.cols * g.rows }, (_, i) => 0.62 * ((i % g.cols) / g.cols) + 0.38 * hash(i, 9));
    let raf = 0;
    const start = performance.now();
    let first = true;
    const frame = (now: number) => {
      // hide the name again on a replay, from the first frame rather than inside the effect
      if (first) {
        first = false;
        setShown(false);
      }
      const k = DUR ? out((now - start) / DUR) : 1;
      const T = k * (1 + 2 * WIPE) - WIPE;
      drawMark(ctx, g, w, h, {
        color,
        glyph,
        tick: Math.floor(now / 60),
        state: (_c, _r, i) => {
          const d = (T - thr[i]) / WIPE;
          return d <= -1 ? "none" : d < 1 ? "glyph" : "dot";
        },
      });
      if (k < 1) raf = requestAnimationFrame(frame);
      else {
        setShown(true);
        if (!name) done.current?.();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, color, glyph, play, name]);

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.18 }}>
      <canvas ref={ref} aria-hidden />
      {name && (
        <span style={{ overflow: "hidden", display: "inline-block" }}>
          <span
            onTransitionEnd={() => shown && done.current?.()}
            style={{
              display: "inline-block",
              fontWeight: 600,
              fontSize: size * 0.62,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: WHITE,
              transform: shown ? "translateX(0)" : "translateX(-105%)",
              opacity: shown ? 1 : 0,
              transition: "transform 600ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease-out",
            }}
          >
            baghedge
          </span>
        </span>
      )}
    </span>
  );
}
