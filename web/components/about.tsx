"use client";

import { LinkedinLogo, XLogo } from "@phosphor-icons/react";
import { motion, useScroll } from "motion/react";
import { useCallback, useRef } from "react";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import type { Source } from "@/lib/field";
import { APP_URL } from "@/lib/site";

const EASE = [0.16, 1, 0.3, 1] as const;
const FALL: Source[] = [{ kind: "image", src: "/art/bag-fall.webp", scale: 0.9 }];

// four chapters. on wide screens the object on the left morphs between them as you read
const CHAPTERS: { label: string; text: string; art: Source }[] = [
  {
    label: "The night",
    text: "It was the middle of the night when the market fell. Our coins sat where they always sit: a Ledger in a drawer, SOL staked in Phantom.",
    art: { kind: "image", src: "/art/device.webp", scale: 0.86 },
  },
  {
    label: "The choice",
    text: "We had two choices. Sell coins we'd held for years, or watch. Opening a short by hand meant guessing the size, the price and the margin, half asleep, on an exchange that had no idea what was in our wallets. We watched. Most holders did.",
    art: { kind: "image", src: "/art/hourglass.webp", scale: 0.8 },
  },
  {
    label: "What we built",
    text: "So we built what we wanted that night. Draw a line under a coin. Below it, a short on Hyperliquid covers what your wallet holds. Above it, nothing runs. Your coins never move.",
    art: { kind: "image", src: "/art/bag-front.webp", scale: 0.84, hot: true },
  },
  {
    label: "Why us",
    text: "We've spent years on privacy infrastructure and enclaves, so the hard part felt familiar: a guard in an enclave that can trade but never withdraw, and a contract on NEAR that only pays out to you.",
    art: { kind: "image", src: "/art/padlock.webp", scale: 0.78 },
  },
];
const STORY_ART = CHAPTERS.map((c) => c.art);

const PEOPLE: { name: string; title: string; bio: string; art: Source[]; links: { label: string; href: string; icon: "x" | "in" }[] }[] = [
  {
    name: "Vivek",
    title: "Co-founder & CEO",
    bio: "Builds products people can feel. Before baghedge he made musdy, a one dollar way to buy any coin on any chain from Mezo, and Liquid Components, open-code Liquid Glass components for React and shadcn/ui. Designs and animates everything you see here.",
    art: [{ kind: "image", src: "/art/portrait-vivek.webp", scale: 1 }],
    links: [
      { label: "X", href: "https://x.com/vwakesahu", icon: "x" },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/vwakesahu/", icon: "in" },
    ],
  },
  {
    name: "Mihir",
    title: "Co-founder & CTO",
    bio: "Writes the parts of baghedge that hold keys: the NEAR contract that owns every hedge account, and the guard in the OutLayer enclave that is the only thing allowed to trade on it.",
    art: [{ kind: "image", src: "/art/portrait-mihir.webp", scale: 1 }],
    links: [
      { label: "X", href: "https://x.com/0xmihirsahu", icon: "x" },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/0xmihirsahu/", icon: "in" },
    ],
  },
  {
    name: "Claude × ChatGPT",
    title: "100x employee",
    bio: "Never sleeps, never asks for equity. Wrote half the code, drew the diagrams, and argued with us about easing curves. Lost most of those.",
    art: [{ kind: "image", src: "/art/team-ai.webp", scale: 0.92 }],
    links: [
      { label: "X", href: "https://x.com/claudeai", icon: "x" },
      { label: "X", href: "https://x.com/OpenAI", icon: "x" },
    ],
  },
];

const BELIEFS = [
  { title: "Your coins stay home.", body: "We read wallets. We never hold them, and we never ask for the keys." },
  { title: "Say the price, say the risk.", body: "“Hedge below $140”, with what can go wrong written right next to it." },
  { title: "Only you take money out.", body: "The key that trades can't withdraw. The contract only pays out to you." },
];

function Story() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const at = useCallback(() => scrollYProgress.get() * (CHAPTERS.length - 1), [scrollYProgress]);
  return (
    <section className="bg-coal rounded-[20px] px-6 py-10 sm:rounded-[24px] sm:px-12 sm:py-0">
      <div ref={ref} className="sm:grid sm:grid-cols-2 sm:gap-16">
        <div className="hidden sm:block">
          <div className="sticky top-0 flex h-svh items-center">
            <div className="aspect-square max-h-[70svh] w-full">
              <Field sources={STORY_ART} at={at} pitch={[5, 6]} intro hover />
            </div>
          </div>
        </div>
        <div>
          {CHAPTERS.map((c) => (
            <motion.div
              key={c.label}
              className="flex flex-col justify-center py-10 sm:min-h-svh sm:py-0"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.8, ease: EASE }}
            >
              <div className="mb-8 aspect-[4/3] w-full sm:hidden">
                <Field sources={[c.art]} pitch={[5, 6]} intro />
              </div>
              <p className="text-[14px] text-white/50 sm:text-[15px]">{c.label}</p>
              <p className="mt-4 max-w-[560px] text-[20px] leading-[1.5] tracking-[-0.01em] text-white/90 sm:text-[24px]">{c.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

export function AboutPage() {
  return (
    <div className="flex flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <section className="bg-coal relative h-[calc(100svh-16px)] overflow-hidden rounded-[20px] sm:h-[calc(100svh-24px)] sm:rounded-[24px]">
        <Header />
        <div className="absolute inset-x-3 top-[11%] h-[46%] sm:left-1/2 sm:top-[10%] sm:h-[54%] sm:w-[52%] sm:-translate-x-1/2">
          <Field sources={FALL} pitch={[5, 6]} intro hover />
        </div>
        <motion.div
          className="absolute inset-x-6 bottom-[7%] flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
        >
          <p className="text-[14px] text-white/60 sm:text-[15px]">10 October 2025</p>
          <h1 className="mt-3 max-w-[18ch] text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[40px]">baghedge started with one bad night.</h1>
          <p className="mt-4 max-w-[440px] text-[15px] leading-[1.5] text-white/70 sm:text-[16px]">
            $3.21 billion of leveraged positions were liquidated in a single minute.
          </p>
        </motion.div>
      </section>

      <Story />

      <section className="bg-coal rounded-[20px] px-5 py-12 sm:rounded-[24px] sm:px-12 sm:py-16">
        <Reveal>
          <h2 className="text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">The team.</h2>
        </Reveal>
        <div className="mt-10 grid gap-12 sm:mt-14 sm:grid-cols-3 sm:gap-6">
          {PEOPLE.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08}>
              <div className="aspect-square w-full">
                <Field sources={p.art} pitch={[4, 6]} square intro hover />
              </div>
              <div className="mt-6 max-w-[520px]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[22px] font-semibold sm:text-[26px]">{p.name}</p>
                    <p className="mt-1 text-[15px] text-white/60">{p.title}</p>
                  </div>
                  <div className="flex gap-4 text-white/70">
                    {p.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on ${l.label}`} className="transition-colors hover:text-brand">
                        {l.icon === "x" ? <XLogo size={20} /> : <LinkedinLogo size={20} />}
                      </a>
                    ))}
                  </div>
                </div>
                <p className="mt-4 text-[16px] leading-[1.6] text-white/80">{p.bio}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-coal rounded-[20px] px-5 py-12 sm:rounded-[24px] sm:px-12 sm:py-16">
        <Reveal>
          <h2 className="text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">What we hold to.</h2>
        </Reveal>
        <div className="mt-10 grid gap-10 sm:mt-14 sm:grid-cols-3 sm:gap-12">
          {BELIEFS.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.08}>
              <p className="text-[22px] leading-[1.2] tracking-[-0.01em] sm:text-[26px]">{b.title}</p>
              <p className="mt-3 text-[16px] leading-[1.6] text-white/75">{b.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-brand flex flex-col items-center rounded-[20px] px-6 py-20 text-center text-[#16120f] sm:rounded-[24px] sm:py-28">
        <Reveal>
          <h2 className="text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Built for the coins people keep.</h2>
        </Reveal>
        <Reveal delay={0.15}>
          <a
            href={APP_URL}
            className="mt-8 inline-flex rounded-[12px] bg-[#16120f] px-6 py-3.5 text-[16px] font-medium text-white transition-transform active:scale-[0.97]"
          >
            Launch app
          </a>
        </Reveal>
      </section>
    </div>
  );
}
