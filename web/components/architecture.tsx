"use client";

import { motion, useMotionValue, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, useState, type RefObject } from "react";
import { Diagram, NODES } from "@/components/diagram";
import { Copy } from "@/components/copy";
import { cn } from "@/lib/utils";

// scroll per step, in svh
const SEG = 45;

const STEPS = [
  "Sign in with Google. Your coins stay in your own wallets.",
  "A guard in an OutLayer enclave watches the price and what you hold.",
  "A NEAR contract owns the hedge account. It only pays out to you.",
  "Margin lands on Hyperliquid as USDC, from any chain.",
  "Only the guard can trade, and it can't withdraw.",
];

// the diagram builds itself as you scroll, one caption per step. it pins while the next card slides over it
export function Architecture({ sectionRef, recede }: { sectionRef: RefObject<HTMLElement | null>; recede?: MotionValue<number> }) {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start end", "end end"] });
  const total = 100 + STEPS.length * SEG;
  // starts drawing while the card is still sliding in
  const s = useTransform(scrollYProgress, (p) => (p * total - 100) / SEG + 0.6);
  const zero = useMotionValue(0);
  const scale = useTransform(recede ?? zero, [0, 1], [1, 0.94]);
  const shade = useTransform(recede ?? zero, [0, 1], [0, 0.6]);
  const [active, setActive] = useState(-1);
  const [pivot, setPivot] = useState(0);

  useMotionValueEvent(s, "change", (v) => {
    const k = v < 0.3 ? -1 : Math.min(STEPS.length - 1, Math.floor(v - 0.3));
    if (k !== active) {
      setActive(k);
      setPivot(v - 0.3);
    }
  });

  return (
    <section ref={sectionRef} id="how" className="relative z-10 -mt-[100svh]" style={{ height: `${total + 100}svh` }}>
      <div ref={track} className="pointer-events-none absolute inset-x-0 top-0" style={{ height: `${total}svh` }} />
      <div className="sticky top-0 h-svh p-2 sm:p-3">
        <motion.div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]" style={{ scale }}>
          <div className="absolute inset-x-6 top-[72px] z-10 sm:left-12 sm:right-auto sm:top-[96px] sm:w-[46%] sm:max-w-[640px]">
            {STEPS.map((text, k) => (
              <Copy key={k} state={k === active ? "in" : k < pivot ? "up" : "down"} title={text} />
            ))}
          </div>
          <Diagram s={s} active={active} className="absolute inset-x-12 bottom-[7%] top-[34%] hidden sm:flex" />
          <Stack s={s} active={active} />
          <motion.div className="pointer-events-none absolute inset-0 z-30 bg-black" style={{ opacity: shade }} />
        </motion.div>
      </div>
    </section>
  );
}

// on a phone the wide diagram won't read, so the parts stack up in order instead
function Stack({ s, active }: { s: MotionValue<number>; active: number }) {
  const lit = active < 0 ? null : ["app privy wallets", "wallets guard keeper", "app near", "app oneclick hl", "guard hl"][active].split(" ");
  return (
    <ol className="absolute inset-x-6 bottom-8 top-[46%] flex flex-col justify-end gap-2.5 sm:hidden">
      {NODES.map((n) => (
        <Row key={n.id} step={n.step} s={s}>
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-[15px] transition-opacity duration-500",
              !lit || lit.includes(n.id) ? "border-brand bg-brand text-[#16120f]" : "border-white/20 bg-white/[0.04]",
            )}
          >
            {n.logos?.map((src) => (
              <img key={src} src={src} alt="" className={cn("size-5 rounded-full object-contain", src.includes("ledger") && "invert")} />
            ))}
            <span>{n.name}</span>
            {n.note && <span className="truncate text-white/45">{n.note}</span>}
          </div>
        </Row>
      ))}
    </ol>
  );
}

function Row({ step, s, children }: { step: number; s: MotionValue<number>; children: React.ReactNode }) {
  const opacity = useTransform(s, [step + 0.2, step + 0.6], [0, 1], { clamp: true });
  const y = useTransform(s, [step + 0.2, step + 0.6], [14, 0], { clamp: true });
  return <motion.li style={{ opacity, y }}>{children}</motion.li>;
}
