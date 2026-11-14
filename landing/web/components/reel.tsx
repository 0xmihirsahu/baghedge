"use client";

import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DotChart } from "@/components/chart";
import { Field } from "@/components/field";
import type { Source } from "@/lib/field";
import { LOGO, fetchCandles, fmtPct, fmtPrice, useMarkets, type Coin } from "@/lib/markets";

const PITCH: [number, number] = [5, 6];
const INK = "#16120f";

// card fill, its text, the dot colour and the accent for glyphs
const FILLS = {
  coral: { bg: "bg-brand text-[#16120f]", foot: "text-[#16120f]/75", dot: INK, accent: "#ffffff" },
  coal: { bg: "bg-coal text-white", foot: "text-white/75", dot: "#ffffff", accent: "#f0645a" },
};

type Card = { title: string; source?: Source; visual?: "markets" | "rule"; fill: keyof typeof FILLS; foot?: string };

// wording follows docs/BAGHEDGE_CONTEXT.md: a trading terminal first, with a wallet hedge for SOL in Phantom
const CARDS: Card[] = [
  { title: "Trade perps on Hyperliquid.", visual: "markets", fill: "coral", foot: "Search markets, read candles, place orders." },
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

const BOARD: Coin[] = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE"];

// live perps from hyperliquid, the first thing the terminal shows
function Markets() {
  const { markets } = useMarkets();
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="mb-3 text-[13px] text-[#16120f]/70">Live from Hyperliquid</p>
      {BOARD.map((c) => {
        const m = markets[c];
        return (
          <div key={c} className="flex items-center gap-3 border-t border-[#16120f]/15 py-3 text-[17px] sm:py-3.5 sm:text-[20px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO[c]} alt="" className="size-7 rounded-full" />
            <span className="font-medium">{c}</span>
            <span className="ml-auto tabular-nums">${fmtPrice(m?.mark)}</span>
            <span className="w-[76px] text-right tabular-nums text-[#16120f]/70">{fmtPct(m?.change)}</span>
          </div>
        );
      })}
    </div>
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
  useEffect(() => {
    fetchCandles("SOL", "1h", 96)
      .then((c) => setCloses(c.map((k) => k.close)))
      .catch(() => setCloses([]));
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
                  : card.foot;
              return (
                <ReelCard key={i} card={card} foot={foot}>
                  {card.visual === "markets" ? (
                    <Markets />
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
