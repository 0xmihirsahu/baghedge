"use client";

import { motion, useInView, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DotChart } from "@/components/chart";
import { Field } from "@/components/field";
import type { Source } from "@/lib/field";
import { fetchCandles, fmtPrice, useMarkets, type Candle } from "@/lib/markets";

const PITCH: [number, number] = [5, 6];
const INK = "#16120f";

// card fill, its text, the dot colour and the accent for glyphs
const FILLS = {
  coral: { bg: "bg-brand text-[#16120f]", foot: "text-[#16120f]/75", dot: INK, accent: "#ffffff" },
  coal: { bg: "bg-coal text-white", foot: "text-white/75", dot: "#ffffff", accent: "#f0645a" },
};

type Card = { title: string; source?: Source; visual?: "candles" | "rule"; fill: keyof typeof FILLS; foot?: string };

// wording follows docs/BAGHEDGE_CONTEXT.md: a trading terminal first, with a wallet hedge for SOL in Phantom
const CARDS: Card[] = [
  { title: "Trade perps on Hyperliquid.", visual: "candles", fill: "coral", foot: "Search markets, read candles, place orders." },
  { title: "Hedge the SOL in your wallet.", visual: "rule", fill: "coal" },
  {
    title: "Your SOL never moves.",
    source: { kind: "image", src: "/art/phone.webp", scale: 0.8 },
    fill: "coral",
    foot: "We watch your Phantom address. The short lives in a separate hedge account.",
  },
  {
    title: "It follows your wallet.",
    source: { kind: "image", src: "/art/coins.webp", scale: 0.8 },
    fill: "coal",
    foot: "If your watched SOL drops below the short, baghedge buys back the excess.",
  },
  {
    title: "A key that only does what your rule allows.",
    source: { kind: "image", src: "/art/padlock.webp", scale: 0.78 },
    fill: "coral",
    foot: "It lives in an OutLayer enclave, it's named, and it expires.",
  },
];

// real SOL 4h candles drawn in dots: up candles white, down candles ink, wicks as smaller dots. draws in left to right
function Candles({ candles }: { candles: Candle[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  const VW = 600, VH = 520;
  if (candles.length < 2) return <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full" aria-hidden />;
  const lo = Math.min(...candles.map((c) => c.low)), hi = Math.max(...candles.map((c) => c.high));
  const Y = (v: number) => 20 + (1 - (v - lo) / (hi - lo || 1)) * (VH - 40);
  const step = VW / candles.length;
  const col = (x: number, a: number, b: number, gap: number, r: number) => {
    const out: number[] = [];
    for (let y = Math.min(a, b); y <= Math.max(a, b) + 0.1; y += gap) out.push(y);
    if (!out.length) out.push(a);
    return out.map((y, i) => <circle key={i} cx={x} cy={y} r={r} />);
  };
  return (
    <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" aria-hidden>
      {candles.map((c, i) => {
        const x = step * (i + 0.5), up = c.close >= c.open;
        return (
          <motion.g
            key={c.time}
            fill={up ? "#ffffff" : INK}
            initial={{ opacity: 0, y: 8 }}
            animate={seen ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.025 }}
          >
            {col(x, Y(c.high), Y(c.low), 6, 1.5)}
            {col(x, Y(c.open), Y(c.close), 8, Math.min(step * 0.34, 4.6))}
          </motion.g>
        );
      })}
    </svg>
  );
}

// scrolling down slides the row of cards sideways. it stays pinned while the next card slides over it
export function Reel({ recede }: { recede?: MotionValue<number> }) {
  const track = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(0);
  const [vh, setVh] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, (p) => -p * travel);
  const zero = useMotionValue(0);
  const scale = useTransform(recede ?? zero, [0, 1], [1, 0.94]);
  const shade = useTransform(recede ?? zero, [0, 1], [0, 0.6]);

  const { markets } = useMarkets();
  const [closes, setCloses] = useState<number[]>([]);
  const [bars, setBars] = useState<Candle[]>([]);
  useEffect(() => {
    fetchCandles("SOL", "1h", 96)
      .then((c) => setCloses(c.map((k) => k.close)))
      .catch(() => setCloses([]));
    fetchCandles("SOL", "4h", 4 * 34)
      .then(setBars)
      .catch(() => setBars([]));
  }, []);
  // the rule: entry 7% under the live mark, recovery 15% above the entry, the same shape as the brief's $140 and $161
  const mark = markets.SOL?.mark;
  const entry = mark ? Math.round(mark * 0.93 * 100) / 100 : 0;
  const recovery = entry ? Math.round(entry * 1.15 * 100) / 100 : 0;

  useEffect(() => {
    const measure = () => {
      setTravel(Math.max(0, row.current!.scrollWidth - window.innerWidth));
      setVh(window.innerHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row.current!);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <section className="relative" style={{ height: vh ? travel + vh * 2 : "300svh" }}>
      <div ref={track} className="pointer-events-none absolute inset-x-0 top-0" style={{ height: vh ? travel + vh : "200svh" }} />
      <div className="sticky top-0 h-svh overflow-hidden">
        <motion.div className="h-full" style={{ scale }}>
          <motion.div ref={row} className="flex h-full w-max gap-2 p-2 sm:gap-3 sm:p-3" style={{ x }}>
            {CARDS.map((card, i) => {
              const f = FILLS[card.fill];
              const foot =
                card.visual === "rule"
                  ? mark
                    ? `Live: hedge up to 6 SOL if the mark crosses down through $${fmtPrice(entry)}. Try to close on recovery to $${fmtPrice(recovery)}. Runs once.`
                    : undefined
                  : card.visual === "candles" && mark
                    ? `Live SOL-PERP, 4h candles, $${fmtPrice(mark)} now. Search markets, read candles, place orders.`
                    : card.foot;
              return (
                <ReelCard key={i} card={card} foot={foot}>
                  {card.visual === "candles" ? (
                    <Candles candles={bars} />
                  ) : card.visual === "rule" ? (
                    <DotChart
                      closes={closes}
                      ink={f.dot}
                      levels={
                        entry
                          ? [
                              { price: recovery, label: `Try to close at $${fmtPrice(recovery)}`, color: "#ffffff" },
                              { price: entry, label: `Short opens below $${fmtPrice(entry)}`, color: "#f0645a" },
                            ]
                          : []
                      }
                    />
                  ) : (
                    <Field sources={[card.source!]} pitch={PITCH} color={f.dot} accent={f.accent} intro hover />
                  )}
                </ReelCard>
              );
            })}
          </motion.div>
          <motion.div className="pointer-events-none absolute inset-0 bg-page" style={{ opacity: shade }} />
        </motion.div>
      </div>
    </section>
  );
}

function ReelCard({ card, foot, children }: { card: Card; foot?: string; children: React.ReactNode }) {
  const f = FILLS[card.fill];
  return (
    <article className={`relative h-full w-[86vw] shrink-0 overflow-hidden rounded-[20px] sm:w-[46vw] sm:rounded-[24px] ${f.bg}`}>
      <h3 className="absolute left-7 right-7 top-8 z-10 text-[26px] leading-[1.15] tracking-[-0.02em] sm:left-12 sm:right-12 sm:top-12 sm:max-w-[460px] sm:text-[36px]">
        {card.title}
      </h3>
      <div className="absolute inset-x-8 bottom-24 top-[30%] sm:inset-x-14 sm:bottom-28 sm:top-[27%]">{children}</div>
      {foot && <p className={`absolute bottom-7 left-7 right-7 text-[15px] leading-[1.45] sm:bottom-10 sm:left-12 sm:right-12 ${f.foot}`}>{foot}</p>}
    </article>
  );
}
