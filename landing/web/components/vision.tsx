"use client";

import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
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
        <Film />
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

// the film is pure black; screen blends it into the card so only the type and dots show (no fade on the element:
// an opacity animation would isolate the blend and flash the black). it autoplays muted, as browsers require;
// one button turns the score on, from the start so the build lands on the drop
function Film() {
  const video = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    const on = !sound;
    v.muted = !on;
    if (on) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setSound(on);
  };
  return (
    <div className="relative">
      <video ref={video} src="/media/vision.mp4" poster="/media/vision.jpg" autoPlay muted loop playsInline className="aspect-video w-full mix-blend-screen" />
      <button
        onClick={toggle}
        aria-pressed={sound}
        aria-label={sound ? "Turn sound off" : "Turn sound on"}
        className="absolute bottom-3 right-3 flex h-10 items-center gap-2 rounded-[12px] bg-[#1c1b1a] px-3.5 text-[14px] font-medium text-white/85 transition-[background-color,scale] duration-150 hover:bg-[#2a2826] active:scale-[0.97] sm:bottom-5 sm:right-5"
      >
        {sound ? <SpeakerHigh size={18} weight="fill" /> : <SpeakerSlash size={18} weight="fill" />}
        {sound ? "Sound off" : "Sound on"}
      </button>
    </div>
  );
}
