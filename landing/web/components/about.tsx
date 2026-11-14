"use client";

import { LinkedinLogo, XLogo } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import type { Source } from "@/lib/field";

const EASE = [0.16, 1, 0.3, 1] as const;

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
    art: [{ kind: "image", src: "/art/team-ai.webp", scale: 0.78 }],
    links: [
      { label: "X", href: "https://x.com/claudeai", icon: "x" },
      { label: "X", href: "https://x.com/OpenAI", icon: "x" },
    ],
  },
];

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

// two cards: the night it started, then the people
export function AboutPage() {
  return (
    <div className="flex flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <section className="bg-coal relative rounded-[20px] px-6 pb-14 pt-[120px] sm:rounded-[24px] sm:px-12 sm:pb-20 sm:pt-[168px]">
        <Header />
        <Reveal>
          <p className="text-[14px] text-white/55 sm:text-[15px]">10 October 2025</p>
          <h1 className="mt-3 max-w-[16ch] text-[32px] leading-[1.1] tracking-[-0.025em] sm:text-[52px]">baghedge started with one bad night.</h1>
        </Reveal>
        <Reveal delay={0.12} className="mt-10 grid max-w-[1100px] gap-6 sm:mt-14 sm:grid-cols-2 sm:gap-12">
          <p className="text-[18px] leading-[1.55] text-white/85 sm:text-[20px]">
            $3.21 billion of leveraged positions were liquidated in a single minute. Our coins sat where they always sit, a Ledger in a
            drawer and SOL staked in Phantom, and we had two choices: sell coins we&apos;d held for years, or watch. We watched. Most holders
            did.
          </p>
          <p className="text-[18px] leading-[1.55] text-white/85 sm:text-[20px]">
            So we built what we wanted that night. Draw a line under a coin. Below it, a short on Hyperliquid covers what your wallet
            holds. Above it, nothing runs, and your coins never move.
          </p>
        </Reveal>
      </section>

      <section className="bg-coal rounded-[20px] px-5 py-10 sm:rounded-[24px] sm:px-12 sm:py-14">
        <Reveal>
          <h2 className="text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">The team.</h2>
        </Reveal>
        <div className="mt-8 grid gap-2 sm:mt-10 sm:grid-cols-3 sm:gap-3">
          {PEOPLE.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08} className="flex flex-col overflow-hidden rounded-[16px] bg-[#151413] sm:rounded-[20px]">
              <div className="aspect-[1/0.9] w-full px-6 pt-6">
                <Field sources={p.art} pitch={[4, 5]} square intro hover />
              </div>
              <div className="flex flex-1 flex-col border-t border-white/10 px-6 pb-7 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[22px] font-semibold leading-tight">{p.name}</p>
                    <p className="mt-1 text-[15px] text-white/60">{p.title}</p>
                  </div>
                  <div className="flex gap-3 pt-1 text-white/70">
                    {p.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on ${l.label}`} className="transition-colors hover:text-brand">
                        {l.icon === "x" ? <XLogo size={19} /> : <LinkedinLogo size={19} />}
                      </a>
                    ))}
                  </div>
                </div>
                <p className="mt-4 text-[15px] leading-[1.6] text-white/75">{p.bio}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
