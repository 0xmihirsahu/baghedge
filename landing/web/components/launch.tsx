"use client";

import type { RefObject } from "react";
import { Field } from "@/components/field";
import type { Source } from "@/lib/field";
import { APP_URL } from "@/lib/site";

const BAG: Source[] = [{ kind: "image", src: "/art/bag-front.webp", scale: 0.9 }];
const PITCH: [number, number] = [5, 6];
const INK = "#16120f";

// the hero again, flipped: a coral card, the bag in ink dots, one button
export function Launch({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  return (
    <section ref={sectionRef} id="launch" className="relative z-20 -mt-[100svh] h-svh p-2 sm:p-3">
      <div className="relative h-full overflow-hidden rounded-[20px] bg-brand text-[#16120f] sm:rounded-[24px]">
        <div className="absolute inset-x-3 top-[9%] h-[52%] sm:left-1/2 sm:top-[8%] sm:h-[58%] sm:w-[52%] sm:-translate-x-1/2">
          <Field sources={BAG} pitch={PITCH} color={INK} accent="#ffffff" intro hover />
        </div>
        <div className="absolute inset-x-6 bottom-[8%] flex flex-col items-center text-center sm:bottom-[9%]">
          <h2 className="text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Draw your first line.</h2>
          <a
            href={APP_URL}
            className="mt-6 inline-flex rounded-[12px] bg-[#16120f] px-6 py-3.5 text-[16px] font-medium text-white transition-transform active:scale-[0.97]"
          >
            Launch app
          </a>
        </div>
      </div>
    </section>
  );
}
