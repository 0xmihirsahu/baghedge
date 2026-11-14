"use client";

import { motion } from "motion/react";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import { VisionFilm } from "@/components/vision-film";
import type { Source } from "@/lib/field";
import { APP_URL } from "@/lib/site";

const EASE = [0.16, 1, 0.3, 1] as const;
const PITCH: [number, number] = [5, 6];

const LINES: { text: string; art: Source }[] = [
  {
    text: "Most crypto sits still. In Ledgers in drawers, in staked SOL, in bags people have held for years.",
    art: { kind: "image", src: "/art/device.webp", scale: 0.9 },
  },
  {
    text: "When the market falls, holders get two bad choices: sell, or sit through it.",
    art: { kind: "image", src: "/art/bag-fall.webp", scale: 0.9 },
  },
  {
    text: "We want every wallet to have a third one. A line under each coin, and a short that only exists below it.",
    art: { kind: "image", src: "/art/bag-front.webp", scale: 0.86, hot: true },
  },
  {
    text: "Today that's BTC, ETH, SOL, HYPE and NEAR on Hyperliquid. Next, any coin with a perp, in any wallet we can read.",
    art: { kind: "image", src: "/art/coins.webp", scale: 0.84 },
  },
];

// rises word by word the first time it scrolls into view
function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <motion.p
      className="text-[26px] leading-[1.2] tracking-[-0.02em] sm:text-[36px]"
      initial="out"
      whileInView="in"
      viewport={{ once: true, amount: 0.6 }}
    >
      {words.map((w, i) => (
        <span key={i}>
          <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-top">
            <motion.span
              className="inline-block"
              variants={{ out: { y: "110%" }, in: { y: "0%" } }}
              transition={{ duration: 0.8, ease: EASE, delay: i * 0.025 }}
            >
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </motion.p>
  );
}

export function VisionPage() {
  return (
    <>
      <section className="h-svh p-2 sm:p-3">
        <div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]">
          <Header />
          <div className="absolute inset-x-6 top-[88px] z-10 sm:left-12 sm:right-auto sm:top-[112px] sm:max-w-[640px]">
            <motion.h1
              className="text-[28px] leading-[1.14] tracking-[-0.02em] sm:text-[40px]"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
            >
              A line under every coin people keep.
            </motion.h1>
            <motion.p
              className="mt-3 text-[15px] text-white/70 sm:text-[16px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              Real Hyperliquid prices, the last 30 days. Before fees and funding.
            </motion.p>
          </div>
          <VisionFilm className="absolute inset-x-1 bottom-3 top-[36%] sm:inset-x-4 sm:bottom-2 sm:top-[22%]" />
        </div>
      </section>

      <section className="px-2 pt-2 sm:px-3 sm:pt-3">
        <div className="rounded-[20px] bg-coal px-6 py-10 sm:rounded-[24px] sm:px-12 sm:py-16">
          {LINES.map((l, i) => (
            <div key={l.text} className="grid min-h-[78svh] items-center gap-8 py-10 sm:grid-cols-2 sm:gap-16">
              <div className={`aspect-[4/3] w-full ${i % 2 ? "sm:order-2" : ""}`}>
                <Field sources={[l.art]} pitch={PITCH} intro hover />
              </div>
              <div className="max-w-[560px]">
                <Words text={l.text} />
                {i === LINES.length - 1 && (
                  <motion.a
                    href={APP_URL}
                    className="mt-10 inline-flex rounded-[12px] bg-brand px-6 py-3.5 text-[16px] font-medium text-white transition-transform active:scale-[0.97]"
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                  >
                    Launch app
                  </motion.a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
