"use client";

import { motion, useInView } from "motion/react";
import { useId, useRef } from "react";

const VW = 600;
const VH = 540;

type Level = { price: number; label: string; color: string };

// the real price as round dots over a fading halftone fill, with the rule's two lines across it:
// the entry, where a short opens if the mark crosses down, and the recovery, where it tries to close
export function DotChart({ closes, ink, chip = "#0b0908", levels = [] }: { closes: number[]; ink: string; chip?: string; levels?: Level[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  const id = useId().replace(/:/g, "");

  if (closes.length < 2) return <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full" aria-hidden />;

  const prices = [...closes, ...levels.map((l) => l.price)];
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const top = 40, bot = 380;
  const yOf = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (bot - top);
  const pts = closes.map((v, i) => [(i / (closes.length - 1)) * (VW - 40) + 10, yOf(v)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]} ${VH} L${pts[0][0]} ${VH} Z`;
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
      {levels.map((l, i) => {
        const y = yOf(l.price);
        return (
          <motion.g key={l.label} initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={{ duration: 0.6, delay: 1.1 + i * 0.2 }}>
            <line x1={10} x2={VW - 30} y1={y} y2={y} stroke={l.color} strokeWidth={9} strokeLinecap="round" strokeDasharray="0 17" />
            {/* a chip in the card's colour, so the label never sits on the price dots */}
            <rect x={VW - 30 - (l.label.length * 10.4 + 24)} y={y - 46} width={l.label.length * 10.4 + 24} height={32} rx={9} fill={chip} />
            <text x={VW - 42} y={y - 24} textAnchor="end" fontSize={20} fill={l.color}>
              {l.label}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}
