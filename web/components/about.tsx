"use client";

import { LinkedinLogo, XLogo } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import type { Source } from "@/lib/field";

// chunky squares, still clear enough to know who it is
const PITCH: [number, number] = [4, 6];
const EASE = [0.16, 1, 0.3, 1] as const;

// names and roles as they are on inco.org/about-inco
const PEOPLE: { name: string; role: string; art: Source[]; x: string; linkedin: string }[] = [
  {
    name: "Vivek",
    role: "Integration at Inco",
    art: [{ kind: "image", src: "/art/portrait-vivek.webp", scale: 1 }],
    x: "https://x.com/vwakesahu",
    linkedin: "https://www.linkedin.com/in/vwakesahu/",
  },
  {
    name: "Mihir",
    role: "Engineer at Inco",
    art: [{ kind: "image", src: "/art/portrait-mihir.webp", scale: 1 }],
    x: "https://x.com/0xmihirsahu",
    linkedin: "https://www.linkedin.com/in/0xmihirsahu/",
  },
];

// one screen, like the hero: two portraits in square pixels, names under them, the line at the bottom
export function AboutPage() {
  return (
    <section className="h-svh p-2 sm:p-3">
      <div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]">
        <Header />
        <div className="absolute inset-x-4 top-[88px] flex justify-center gap-4 sm:top-[104px] sm:gap-16">
          {PEOPLE.map((p, i) => (
            <motion.figure
              key={p.name}
              className="flex w-[min(44vw,40svh)] flex-col items-center sm:w-[min(30vw,46svh)]"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.1 }}
            >
              <div className="aspect-square w-full">
                <Field sources={p.art} pitch={PITCH} square intro hover />
              </div>
              <figcaption className="mt-4 flex flex-col items-center text-center sm:mt-5">
                <span className="text-[18px] font-semibold sm:text-[22px]">{p.name}</span>
                <span className="mt-1 text-[13px] text-white/70 sm:text-[15px]">{p.role}</span>
                <span className="mt-3 flex gap-4 text-white/70">
                  <a href={p.x} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on X`} className="transition-colors hover:text-brand">
                    <XLogo size={18} />
                  </a>
                  <a href={p.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on LinkedIn`} className="transition-colors hover:text-brand">
                    <LinkedinLogo size={18} />
                  </a>
                </span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
        <motion.div
          className="absolute inset-x-6 bottom-[7%] flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.35 }}
        >
          <h1 className="text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">Built by Vivek and Mihir.</h1>
          <p className="mt-3 max-w-[440px] text-[15px] leading-[1.5] text-white/70 sm:text-[16px]">
            We both build at Inco, the full-stack privacy layer for blockchains.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
