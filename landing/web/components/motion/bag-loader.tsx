"use client";

import { useEffect, useRef } from "react";
import { CORAL, WHITE, drawMark, fit, hash, markGrid, reducedMotion } from "./dots";

// the mark in dots with a band of glyphs sweeping across it, for any loading state. 16 px to 96 px and up
export function BagLoader({
  size = 32,
  color = CORAL,
  glyph = WHITE,
  label = "Loading",
  className,
}: {
  size?: number;
  color?: string;
  glyph?: string;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const g = markGrid(size);
    const h = size, w = Math.round((size * g.cols) / g.rows);
    const ctx = fit(el, w, h);
    const still = reducedMotion();
    let raf = 0, visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      // the band crosses every 1.4 s, a little ragged so it reads as decoding, not a wipe
      const band = still ? -1 : ((now / 1400) % 1) * 1.5 - 0.25;
      drawMark(ctx, g, w, h, {
        color,
        glyph,
        tick: Math.floor(now / 60),
        state: (c, _r, i) => (Math.abs(c / g.cols + (hash(i, 4) - 0.5) * 0.12 - band) < 0.14 ? "glyph" : "dot"),
      });
      if (still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size, color, glyph]);

  return <canvas ref={ref} role="status" aria-label={label} className={className} />;
}
