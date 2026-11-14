"use client";

import { LinkedinLogo, XLogo } from "@phosphor-icons/react";
import type { MotionValue } from "motion/react";
import type { RefObject } from "react";
import { Field } from "@/components/field";
import { Slide } from "@/components/slide";
import type { Source } from "@/lib/field";

// chunky squares, still clear enough to know who it is
const PITCH: [number, number] = [5, 7];

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

export function About({ sectionRef, recede }: { sectionRef: RefObject<HTMLElement | null>; recede?: MotionValue<number> }) {
  return (
    <Slide sectionRef={sectionRef} recede={recede} id="about" z="z-30">
      <h2 className="absolute inset-x-6 top-[72px] z-10 text-[28px] leading-[1.14] tracking-[-0.02em] sm:left-12 sm:top-[96px] sm:text-[40px]">
        Built by Vivek and Mihir.
      </h2>
      <div className="absolute inset-x-4 bottom-4 top-[160px] grid grid-cols-2 content-end gap-2 sm:inset-x-auto sm:bottom-[5%] sm:right-12 sm:top-auto sm:w-[min(980px,66%)] sm:gap-3">
        {PEOPLE.map((p) => (
          <article key={p.name} className="overflow-hidden rounded-[16px] bg-[#141312] sm:rounded-[20px]">
            <div className="aspect-[1/0.9] p-2 sm:p-4">
              <Field sources={p.art} pitch={PITCH} square intro hover />
            </div>
            <div className="flex items-end justify-between gap-3 border-t border-white/10 px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <p className="text-[18px] font-semibold sm:text-[22px]">{p.name}</p>
                <p className="mt-1 text-[13px] text-white/70 sm:text-[15px]">{p.role}</p>
              </div>
              <div className="flex gap-3 text-white/80">
                <a href={p.x} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on X`} className="hover:text-brand">
                  <XLogo size={20} />
                </a>
                <a href={p.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on LinkedIn`} className="hover:text-brand">
                  <LinkedinLogo size={20} />
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Slide>
  );
}
