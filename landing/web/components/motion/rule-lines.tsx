"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CORAL, WHITE, reducedMotion } from "./dots";

// onDrag makes a line draggable: it gets a grab handle and reports the new y as the pointer moves
type Line = { y: number; label: string; onDrag?: (y: number) => void };

// the hedge rule over a chart: the recovery line (white) and the entry line (coral) print in as dotted lines
// when `armed` turns true, labels on chips so they never sit on the candles. place it absolutely over the chart;
// y values are pixels from the top, e.g. from lightweight-charts' series.priceToCoordinate(price)
export function RuleLines({
  entry,
  recovery,
  armed,
  editing = false,
  chip = "#0b0908",
  className,
}: {
  entry?: Line;
  recovery?: Line;
  armed: boolean;
  // while drafting a rule: the lines show at half strength with handles, before anything is armed
  editing?: boolean;
  chip?: string;
  className?: string;
}) {
  const shown = armed || editing;
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
                <mask id={`${id}m${i}`} maskUnits="userSpaceOnUse" x={0} y={-4000} width={w} height={8000}>
                  <line x1={0} x2={w} y1={l.y} y2={l.y} stroke="#fff" strokeWidth={12} pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: shown ? 0 : 1, transition: t }} />
                </mask>
                <g style={{ opacity: armed ? 1 : 0.55, transition: "opacity 400ms ease" }}>
                  <line x1={6} x2={w - 6} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.r * 2} strokeLinecap="round" strokeDasharray="0 11" mask={`url(#${id}m${i})`} />
                </g>
                <g style={{ opacity: shown ? 1 : 0, transition: still ? "none" : `opacity 300ms ease-out ${armed ? l.delay + 500 : 0}ms` }}>
                  <rect x={w - labelW - 6} y={l.y - 30} width={labelW} height={22} rx={7} fill={chip} />
                  <text x={w - 16} y={l.y - 15} textAnchor="end" fontSize={13} fill={l.color} style={{ fontFamily: "inherit" }}>
                    {l.label}
                  </text>
                </g>
                {l.onDrag && editing && (
                  <g>
                    {/* the handle: a bigger dot at the left end, and a wide invisible strip to grab */}
                    <circle cx={14} cy={l.y} r={7} fill={l.color} />
                    <rect
                      x={0}
                      y={l.y - 12}
                      width={w}
                      height={24}
                      fill="transparent"
                      style={{ pointerEvents: "auto", cursor: "ns-resize", touchAction: "none" }}
                      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                      onPointerMove={(e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        l.onDrag!(e.clientY - box.current!.getBoundingClientRect().top);
                      }}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
