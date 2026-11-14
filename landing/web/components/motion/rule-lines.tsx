"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CORAL, WHITE, reducedMotion } from "./dots";

type Line = { y: number; label: string };

// the hedge rule over a chart: the recovery line (white) and the entry line (coral) print in as dotted lines
// when `armed` turns true, labels on chips so they never sit on the candles. place it absolutely over the chart;
// y values are pixels from the top, e.g. from lightweight-charts' series.priceToCoordinate(price)
export function RuleLines({
  entry,
  recovery,
  armed,
  chip = "#0b0908",
  className,
}: {
  entry?: Line;
  recovery?: Line;
  armed: boolean;
  chip?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const id = useId().replace(/:/g, "");
  const still = typeof window !== "undefined" && reducedMotion();

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = [
    recovery && { ...recovery, color: WHITE, r: 2.6, delay: 0 },
    entry && { ...entry, color: CORAL, r: 3.2, delay: 160 },
  ].filter(Boolean) as (Line & { color: string; r: number; delay: number })[];

  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {w > 0 && (
        <svg width={w} height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
          {lines.map((l, i) => {
            const labelW = l.label.length * 7.4 + 20;
            const t = still ? "none" : `stroke-dashoffset 700ms cubic-bezier(0.65, 0, 0.35, 1) ${l.delay}ms`;
            return (
              <g key={i}>
                <mask id={`${id}m${i}`} maskUnits="userSpaceOnUse" x={0} y={l.y - 10} width={w} height={20}>
                  <line x1={0} x2={w} y1={l.y} y2={l.y} stroke="#fff" strokeWidth={12} pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: armed ? 0 : 1, transition: t }} />
                </mask>
                <line x1={6} x2={w - 6} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.r * 2} strokeLinecap="round" strokeDasharray="0 11" mask={`url(#${id}m${i})`} />
                <g style={{ opacity: armed ? 1 : 0, transition: still ? "none" : `opacity 300ms ease-out ${l.delay + 500}ms` }}>
                  <rect x={w - labelW - 6} y={l.y - 30} width={labelW} height={22} rx={7} fill={chip} />
                  <text x={w - 16} y={l.y - 15} textAnchor="end" fontSize={13} fill={l.color} style={{ fontFamily: "inherit" }}>
                    {l.label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
