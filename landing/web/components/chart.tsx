"use client";

import { motion, useInView } from "motion/react";
import { useId, useRef } from "react";

const VW = 600;
const VH = 540;

// the real price line as round dots, a halftone fill fading under it, the hedge line across. it draws left to right on arrival
export function DotChart({ closes, line, ink, accent, mark }: { closes: number[]; line: number; ink: string; accent: string; mark?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  const id = useId().replace(/:/g, "");

  if (closes.length < 2) return <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full" aria-hidden />;

  const lo = Math.min(...closes, line || Infinity), hi = Math.max(...closes);
  const top = 24, bot = 380;
  const yOf = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (bot - top);
  const pts = closes.map((v, i) => [(i / (closes.length - 1)) * (VW - 40) + 10, yOf(v)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]} ${VH} L${pts[0][0]} ${VH} Z`;
  const hy = line ? yOf(line) : 0;
  const [lx, ly] = pts[pts.length - 1];

  return (
    <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full overflow-visible" aria-hidden>
      <defs>
        <pattern id={`p${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="2" fill={ink} />
        </pattern>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`f${id}`}>
          <rect width={VW} height={VH} fill={`url(#g${id})`} />
        </mask>
        <clipPath id={`c${id}`}>
          <motion.rect
            x={0}
            y={-20}
            height={VH + 40}
            initial={{ width: 0 }}
            animate={{ width: seen ? VW + 20 : 0 }}
            transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${id})`}>
        <path d={area} fill={`url(#p${id})`} mask={`url(#f${id})`} />
        <path d={d} fill="none" stroke={ink} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0 10" />
        <circle cx={lx} cy={ly} r={9} fill={ink} />
      </g>
      {line > 0 && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={{ duration: 0.6, delay: 1.2 }}>
          <line x1={10} x2={VW - 30} y1={hy} y2={hy} stroke={accent} strokeWidth={9} strokeLinecap="round" strokeDasharray="0 17" />
          {mark && (
            <text x={VW - 30} y={hy - 18} textAnchor="end" fontSize={20} fill={accent}>
              {mark}
            </text>
          )}
        </motion.g>
      )}
    </svg>
  );
}
