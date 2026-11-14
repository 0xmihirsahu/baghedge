"use client";

import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// drawn at a fixed size, then scaled to fit, like the inco terminal diagram
const W = 1160;
const H = 500;
const CORAL = "#f0645a";
const GLYPHS = "$#%&*+=/\\<>?!0123456789";

type Node = { id: string; x: number; y: number; step: number; name: string; note?: string; logos?: string[] };

// the parts as docs/BAGHEDGE_CONTEXT.md describes them: terminal, watched phantom wallet, worker, guard, 1click and two hyperliquid accounts
export const NODES: Node[] = [
  { id: "app", x: 0, y: 200, step: 0, name: "baghedge", note: "terminal", logos: ["/art/mascot.webp"] },
  { id: "hl", x: 790, y: 200, step: 0, name: "Hyperliquid", note: "Trade + Hedge accounts", logos: ["/brands/hyperliquid.png"] },
  { id: "phantom", x: 0, y: 30, step: 1, name: "Phantom", note: "your SOL, read only", logos: ["/brands/phantom.svg"] },
  { id: "worker", x: 440, y: 30, step: 1, name: "Worker", note: "runs the hedge" },
  { id: "usdc", x: 0, y: 400, step: 2, name: "USDC", note: "on Base", logos: ["/tokens/USDC.png"] },
  { id: "oneclick", x: 440, y: 400, step: 2, name: "1Click", note: "NEAR Intents", logos: ["/brands/near-intents.png"] },
  { id: "guard", x: 440, y: 300, step: 3, name: "Guard", note: "OutLayer enclave" },
];

// which parts are lit while each caption is up
export const LIT: string[][] = [
  ["app", "hl"],
  ["phantom", "worker", "hl"],
  ["usdc", "oneclick", "hl"],
  ["guard", "hl"],
  ["worker", "guard", "hl"],
];

type Box = { l: number; t: number; r: number; b: number; cx: number; cy: number };
type Wire = { d: string; step: number; arrow: boolean; label?: { x: number; y: number; text: string; start?: boolean } };

function layout(b: Record<string, Box>): Wire[] {
  const g = 12;
  const { app, hl, phantom, worker, usdc, oneclick, guard } = b;
  // two verticals into hyperliquid from below: 1click's deposit and the guard's signed short
  const fx = hl.cx + 30, sx = hl.cx - 30;
  return [
    { step: 0, arrow: true, d: `M${app.r + g} ${app.cy} H${hl.l - g}`, label: { x: (app.r + hl.l) / 2, y: app.cy - 14, text: "orders" } },
    { step: 1, arrow: true, d: `M${phantom.r + g} ${phantom.cy} H${worker.l - g}`, label: { x: (phantom.r + worker.l) / 2, y: phantom.cy - 14, text: "balance" } },
    { step: 1, arrow: true, d: `M${worker.r + g} ${worker.cy} H${hl.cx} V${hl.t - g}`, label: { x: hl.cx + 14, y: (worker.cy + hl.t) / 2 + 5, text: "mark", start: true } },
    { step: 2, arrow: true, d: `M${usdc.r + g} ${usdc.cy} H${oneclick.l - g}`, label: { x: (usdc.r + oneclick.l) / 2, y: usdc.cy - 14, text: "USDC" } },
    { step: 2, arrow: true, d: `M${oneclick.r + g} ${oneclick.cy} H${fx} V${hl.b + g}`, label: { x: fx + 14, y: oneclick.cy - 14, text: "to the hedge account", start: true } },
    { step: 3, arrow: true, d: `M${guard.r + g} ${guard.cy} H${sx} V${hl.b + g}`, label: { x: (guard.r + sx) / 2, y: guard.cy - 14, text: "signs the short" } },
  ];
}

// s runs 0..steps as you scroll. each step prints its wires dot by dot, wipes its parts open and decodes their names
export function Diagram({ s, active, className }: { s: MotionValue<number>; active: number; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [wires, setWires] = useState<Wire[]>([]);

  useEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / W, el.clientHeight / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.fonts.ready.then(() => {
      const boxes: Record<string, Box> = {};
      for (const el of inner.current!.querySelectorAll<HTMLElement>("[data-node]")) {
        const l = el.offsetLeft, t = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
        boxes[el.dataset.node!] = { l, t, r: l + w, b: t + h, cx: l + w / 2, cy: t + h / 2 };
      }
      setWires(layout(boxes));
    });
  }, []);

  const lit = active < 0 ? null : LIT[active];

  return (
    <div ref={outer} className={cn("flex items-center justify-center", className)}>
      <div style={{ width: W * scale, height: H * scale }}>
        <div ref={inner} className="relative origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <svg width={W} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              <marker id="tip-on" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0L10 5L0 10z" fill={CORAL} />
              </marker>
              <marker id="tip-off" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="rgba(255,255,255,0.4)" />
              </marker>
            </defs>
            {wires.map((w, i) => (
              <WirePath key={i} id={i} wire={w} s={s} on={!lit || w.step === active} />
            ))}
          </svg>
          {NODES.map((n) => (
            <NodeBox key={n.id} node={n} s={s} on={!lit || lit.includes(n.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// a dotted wire, revealed through a solid mask that draws along it with scroll
function WirePath({ id, wire, s, on }: { id: number; wire: Wire; s: MotionValue<number>; on: boolean }) {
  const offset = useTransform(s, [wire.step, wire.step + 0.6], [1, 0], { clamp: true });
  const fade = useTransform(s, [wire.step + 0.4, wire.step + 0.65], [0, 1], { clamp: true });
  return (
    <>
      <mask id={`wm${id}`} maskUnits="userSpaceOnUse" x={-20} y={-20} width={W + 40} height={H + 40}>
        <motion.path d={wire.d} pathLength={1} fill="none" stroke="#fff" strokeWidth={16} strokeDasharray="1 1" style={{ strokeDashoffset: offset }} />
      </mask>
      <path
        d={wire.d}
        fill="none"
        stroke={on ? CORAL : "rgba(255,255,255,0.4)"}
        strokeWidth={on ? 3.2 : 2.4}
        strokeLinecap="round"
        strokeDasharray="0 9"
        markerEnd={wire.arrow ? `url(#tip-${on ? "on" : "off"})` : undefined}
        mask={`url(#wm${id})`}
        style={{ transition: "stroke 0.5s ease, stroke-width 0.5s ease" }}
      />
      {wire.label && (
        <motion.text
          x={wire.label.x}
          y={wire.label.y}
          textAnchor={wire.label.start ? "start" : "middle"}
          fontSize={14}
          fill={on ? "#ffffff" : "rgba(255,255,255,0.45)"}
          style={{ opacity: fade, transition: "fill 0.5s ease" }}
        >
          {wire.label.text}
        </motion.text>
      )}
    </>
  );
}

// names decode through glyphs once, the first time their node opens
function Scramble({ text, go }: { text: string; go: boolean }) {
  const [shown, setShown] = useState(text);
  const done = useRef(false);
  useEffect(() => {
    if (!go || done.current) return;
    done.current = true;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / 700;
      const keep = Math.floor(t * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) => (ch === " " || i < keep ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
          .join(""),
      );
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [go, text]);
  return (
    <span className="relative inline-block">
      <span className="invisible">{text}</span>
      <span className="absolute inset-0 whitespace-nowrap">{shown}</span>
    </span>
  );
}

function NodeBox({ node, s, on }: { node: Node; s: MotionValue<number>; on: boolean }) {
  const reveal = useTransform(s, [node.step + 0.15, node.step + 0.55], [100, 0], { clamp: true });
  const clip = useTransform(reveal, (r) => `inset(-2px ${r}% -2px -2px round 14px)`);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(reveal, "change", (r) => r < 40 && !open && setOpen(true));
  return (
    <motion.div data-node={node.id} className="absolute w-max" style={{ left: node.x, top: node.y, clipPath: clip }}>
      <div
        className={cn(
          "flex items-center gap-2.5 whitespace-nowrap rounded-[14px] border px-4 py-3 text-[17px] transition-[background-color,border-color,opacity] duration-500",
          on ? "border-brand bg-brand text-[#16120f]" : "border-white/20 bg-[#1a1817] text-white",
        )}
      >
        {node.logos?.map((src) => (
          // the red mascot vanishes on a lit coral node and the black ledger mark on a dark one
          <img
            key={src}
            src={on && src === "/art/mascot.webp" ? "/art/mascot-ink.webp" : src}
            alt=""
            className={cn("size-[22px] rounded-full object-contain", !on && src.includes("ledger") && "invert")}
          />
        ))}
        <span className="font-medium">
          <Scramble text={node.name} go={open} />
        </span>
        {node.note && <span className={on ? "text-[#16120f]/70" : "text-white/55"}>{node.note}</span>}
      </div>
    </motion.div>
  );
}
