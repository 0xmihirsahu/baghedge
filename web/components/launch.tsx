"use client";

import type { RefObject } from "react";
import { Field } from "@/components/field";
import type { Source } from "@/lib/field";
import { APP_URL } from "@/lib/site";

const BAG: Source[] = [{ kind: "image", src: "/art/bag-front.webp", scale: 0.8, hot: true }];
const PITCH: [number, number] = [6, 8];

// the last card slides over the rest: the coral bag decodes in, the app is one click away
export function Launch({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  return (
    <section ref={sectionRef} id="launch" className="relative z-40 -mt-[100svh] h-svh p-2 sm:p-3">
      <div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]">
        <div className="absolute inset-x-6 top-[72px] z-10 sm:left-12 sm:right-auto sm:top-[120px] sm:w-[34%] sm:max-w-[520px]">
          <h2 className="text-[28px] leading-[1.14] tracking-[-0.02em] sm:text-[40px]">Draw your first line.</h2>
          <a
            href={APP_URL}
            className="mt-8 inline-flex rounded-[12px] bg-brand px-6 py-3.5 text-[16px] font-medium text-white transition-transform active:scale-[0.97]"
          >
            Launch app
          </a>
          <p className="mt-10 max-w-[400px] text-[14px] leading-[1.5] text-white/60">
            It&apos;s a hedge, not insurance. A fast drop can fill past your line, and funding is paid every hour and can flip.
          </p>
        </div>
        <div className="absolute inset-x-3 bottom-3 top-[52%] sm:inset-x-auto sm:bottom-[5%] sm:right-[3%] sm:top-[8%] sm:w-[56%]">
          <Field sources={BAG} pitch={PITCH} intro hover />
        </div>
      </div>
    </section>
  );
}
