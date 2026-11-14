"use client";

import { motion } from "motion/react";
import { Header } from "@/components/header";
import { APP_URL } from "@/lib/site";

const EASE = [0.16, 1, 0.3, 1] as const;

const LINES = [
  "Most crypto sits still. In Ledgers in drawers, in staked SOL, in bags people have held for years.",
  "When the market falls, holders get two bad choices: sell, or sit through it.",
  "We want every wallet to have a third one. A line under each coin, and a short on Hyperliquid that opens if the price crosses it and tries to close when it recovers.",
  "We're starting with SOL in Phantom. Next, any coin with a perp, in any wallet we can read.",
];

// the film from the video harness (films/baghedge-hype), then the vision in four lines
export function VisionPage() {
  return (
    <div className="flex flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <section className="bg-coal relative overflow-hidden rounded-[20px] px-3 pb-3 pt-[88px] sm:rounded-[24px] sm:px-6 sm:pb-6 sm:pt-[104px]">
        <Header />
        <motion.video
          src="/media/vision.mp4"
          poster="/media/vision.jpg"
          autoPlay
          muted
          loop
          playsInline
          className="aspect-video w-full rounded-[14px] sm:rounded-[18px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      </section>

      <section className="bg-coal rounded-[20px] px-6 py-16 sm:rounded-[24px] sm:px-12 sm:py-24">
        <motion.div
          className="grid max-w-[1100px] gap-10 sm:grid-cols-2 sm:gap-x-16 sm:gap-y-12"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.025em] sm:col-span-2 sm:text-[52px]">A line under every coin people keep.</h1>
          {LINES.map((l) => (
            <p key={l} className="text-[18px] leading-[1.55] text-white/85 sm:text-[20px]">
              {l}
            </p>
          ))}
          <a
            href={APP_URL}
            className="inline-flex w-max rounded-[12px] bg-brand px-6 py-3.5 text-[16px] font-medium text-white transition-transform active:scale-[0.97]"
          >
            Launch app
          </a>
        </motion.div>
      </section>
    </div>
  );
}
