"use client";

import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DotChart } from "@/components/chart";
import { Field } from "@/components/field";
import type { Source } from "@/lib/field";
import { fetchCandles, fmtPrice, useMarkets } from "@/lib/markets";

const PITCH: [number, number] = [5, 6];
const INK = "#16120f";

// card fill, its text, the dot colour and the accent for glyphs and the hedge line
const FILLS = {
  coral: { bg: "bg-brand text-[#16120f]", foot: "text-[#16120f]/75", dot: INK, accent: "#ffffff" },
  coal: { bg: "bg-coal text-white", foot: "text-white/75", dot: "#ffffff", accent: "#f0645a" },
};

type Card = { title: string; source?: Source; fill: keyof typeof FILLS; foot?: string };

const CARDS: Card[] = [
  { title: "Draw a line under any coin you hold.", fill: "coral" },
  { title: "Your Ledger stays in the drawer. We only read it.", source: { kind: "image", src: "/art/device.webp", scale: 0.86 }, fill: "coal" },
  {
    title: "It follows your wallet, coin for coin.",
    source: { kind: "image", src: "/art/coins.webp", scale: 0.8 },
    fill: "coral",
    foot: "Sell half your SOL and the short halves too.",
  },
  {
    title: "It can only short the coin you hold. It can never withdraw.",
    source: { kind: "image", src: "/art/padlock.webp", scale: 0.78 },
    fill: "coal",
  },
];

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
  const mark = markets.SOL?.mark;
  const line = mark ? Math.round(mark * 0.93 * 100) / 100 : 0;

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
              return (
                <ReelCard
                  key={i}
                  card={card}
                  foot={i === 0 ? (mark ? `SOL is $${fmtPrice(mark)} right now. Below the line, a short opens.` : undefined) : card.foot}
                >
                  {card.source ? (
                    <Field sources={[card.source]} pitch={PITCH} color={f.dot} accent={f.accent} intro hover />
                  ) : (
                    <DotChart closes={closes} line={line} ink={f.dot} accent={f.accent} mark={line ? `Hedge below $${fmtPrice(line)}` : undefined} />
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
      <div className="absolute inset-x-8 bottom-20 top-[30%] sm:inset-x-14 sm:bottom-24 sm:top-[27%]">{children}</div>
      {foot && <p className={`absolute bottom-7 left-7 right-7 text-[15px] sm:bottom-10 sm:left-12 ${f.foot}`}>{foot}</p>}
    </article>
  );
}
