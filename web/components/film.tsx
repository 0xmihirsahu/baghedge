"use client";

import { MotionConfig, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/field";
import { Mascot } from "@/components/mascot";
import { Waitlist } from "@/components/waitlist";
import type { Source } from "@/lib/field";
import { fetchCandles, fmtPrice, useMarkets } from "@/lib/markets";

// scroll height per scene, in svh
const SEG = 90;
const EASE = [0.16, 1, 0.3, 1] as const;
const PITCH: [number, number] = [6, 8];

type Scene = { source: Source | "chart"; title: string; sub?: string };

const SCENES: Scene[] = [
  {
    source: { kind: "image", src: "/art/bag-hero-a.webp", scale: 0.86 },
    title: "Protect your bags without selling a coin.",
    sub: "Draw a line under the coins you keep. If the price breaks it, a short on Hyperliquid covers you.",
  },
  { source: "chart", title: "Draw a line under any coin you hold." },
  { source: { kind: "image", src: "/art/device.webp", scale: 0.92 }, title: "Your Ledger stays in the drawer. We only read it." },
  {
    source: { kind: "image", src: "/art/coins.webp", scale: 0.84 },
    title: "It follows your wallet, coin for coin.",
    sub: "Sell half your SOL and the short halves too. Margin is USDC, sent from any chain.",
  },
  { source: { kind: "image", src: "/art/padlock.webp", scale: 0.78 }, title: "It can only short the coin you hold. It can never withdraw." },
  { source: { kind: "image", src: "/art/hourglass.webp", scale: 0.8 }, title: "Funding is paid every hour, and it can flip against you." },
  { source: { kind: "image", src: "/art/bag-fall.webp", scale: 0.9 }, title: "It's a hedge, not insurance.", sub: "A fast drop can fill past your line." },
  { source: { kind: "image", src: "/art/bag-front.webp", scale: 0.8, hot: true }, title: "Hedges open to a waitlist first." },
];

const LAST = SCENES.length - 1;

// which title is up: one per scene, none while the dots are moving between objects
function activeAt(s: number) {
  const i = Math.floor(s), f = s - i;
  if (f <= 0.35) return Math.min(i, LAST);
  if (f >= 0.75) return Math.min(i + 1, LAST);
  return -1;
}

export function Film() {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const { markets } = useMarkets();
  const [closes, setCloses] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [pivot, setPivot] = useState(0);

  useEffect(() => {
    fetchCandles("SOL", "1h", 96)
      .then((c) => setCloses(c.map((x) => x.close)))
      .catch(() => setCloses([]));
  }, []);

  const mark = markets.SOL?.mark;
  const line = mark ? Math.round(mark * 0.93 * 100) / 100 : 0;
  const sources = useMemo<Source[]>(
    () => SCENES.map((s) => (s.source === "chart" ? { kind: "chart", closes, line } : s.source)),
    [closes, line],
  );

  const at = useCallback(() => scrollYProgress.get() * LAST, [scrollYProgress]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const s = p * LAST;
    const k = activeAt(s);
    if (k !== active) {
      setActive(k);
      setPivot(s);
    }
  });

  const live = mark
    ? `SOL is $${fmtPrice(mark)} right now. A line 7% under it sits at $${fmtPrice(line)}. Below it, a short opens.`
    : "Below your line, a short opens on Hyperliquid.";

  return (
    <MotionConfig reducedMotion="user">
      <section ref={section} id="top" className="relative" style={{ height: `${LAST * SEG + 100}svh` }}>
        <div id="access" className="pointer-events-none absolute inset-x-0 bottom-0 h-svh" />
        <div className="sticky top-0 h-svh p-2 sm:p-3">
          <div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]">
            <header className="absolute inset-x-0 top-0 z-20 flex h-[72px] items-center justify-between px-6 sm:h-[96px] sm:px-12">
              <a href="#top" className="flex items-center gap-2">
                <Mascot className="size-7" />
                <span className="text-[19px] font-semibold tracking-[-0.03em]">baghedge</span>
              </a>
              <a
                href="#access"
                className="rounded-[10px] bg-brand px-4 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]"
              >
                Get access
              </a>
            </header>

            <div className="absolute inset-x-3 bottom-3 top-[50%] sm:inset-x-auto sm:bottom-[5%] sm:right-[3%] sm:top-[11%] sm:w-[56%]">
              <Field sources={sources} at={at} pitch={PITCH} intro hover />
            </div>

            <div className="absolute inset-x-6 top-[100px] z-10 sm:left-12 sm:right-auto sm:top-[150px] sm:w-[34%] sm:max-w-[520px]">
              {SCENES.map((scene, k) => {
                const state = k === active ? "in" : k < pivot ? "up" : "down";
                return (
                  <Copy key={k} state={state} title={scene.title}>
                    {k === 0 && (
                      <>
                        <p>{scene.sub}</p>
                        <a
                          href="#access"
                          className="mt-8 inline-flex rounded-[10px] bg-white px-4 py-2.5 text-[14px] font-medium text-coal transition-transform active:scale-[0.97]"
                        >
                          Get early access
                        </a>
                      </>
                    )}
                    {k === 1 && <p>{live}</p>}
                    {k > 1 && k < LAST && scene.sub && <p>{scene.sub}</p>}
                    {k === LAST && <Waitlist />}
                  </Copy>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}

// a title that rises word by word out of a mask, then the rest fades in under it
function Copy({ state, title, children }: { state: "in" | "up" | "down"; title: string; children?: ReactNode }) {
  const words = title.split(" ");
  const on = state === "in";
  return (
    <div className={on ? "absolute inset-x-0 top-0" : "pointer-events-none absolute inset-x-0 top-0"} aria-hidden={!on}>
      <h2 className="text-[30px] leading-[1.14] tracking-[-0.02em] text-[#f1f0ef] sm:text-[44px]">
        {words.map((w, i) => (
          <span key={i}>
            <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-top">
              <motion.span
                className="inline-block"
                initial={{ y: "110%" }}
                animate={{ y: on ? "0%" : state === "up" ? "-110%" : "110%" }}
                transition={{ duration: 0.8, ease: EASE, delay: on ? 0.08 + i * 0.035 : i * 0.012 }}
              >
                {w}
              </motion.span>
            </span>
            {i < words.length - 1 && " "}
          </span>
        ))}
      </h2>
      {children && (
        <motion.div
          className="mt-5 max-w-[420px] text-[16px] leading-[1.5] text-white/55 sm:text-[18px]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: on ? 1 : 0, y: on ? 0 : 10 }}
          transition={{ duration: 0.6, ease: EASE, delay: on ? 0.35 : 0 }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}
