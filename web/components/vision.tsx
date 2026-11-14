"use client";

import { motion, useInView, type MotionValue } from "motion/react";
import { useRef, type RefObject } from "react";
import { Slide } from "@/components/slide";

const EASE = [0.16, 1, 0.3, 1] as const;

// the film from the video harness: ten real coins over 30 days, each with a line 7% under where it started
export function Vision({ sectionRef, recede }: { sectionRef: RefObject<HTMLElement | null>; recede?: MotionValue<number> }) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, { once: true, margin: "-25%" });
  return (
    <Slide sectionRef={sectionRef} recede={recede} id="vision" z="z-20">
      <div ref={box} className="absolute inset-x-6 top-[72px] z-10 sm:left-12 sm:right-auto sm:top-[96px] sm:max-w-[620px]">
        <motion.h2
          className="text-[28px] leading-[1.14] tracking-[-0.02em] sm:text-[40px]"
          initial={{ opacity: 0, y: 24 }}
          animate={seen ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease: EASE }}
        >
          A line under every coin people keep.
        </motion.h2>
        <motion.p
          className="mt-4 text-[15px] text-white/70 sm:text-[16px]"
          initial={{ opacity: 0 }}
          animate={seen ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          Real Hyperliquid prices, the last 30 days. Before fees and funding.
        </motion.p>
      </div>
      <div className="absolute inset-x-2 bottom-4 top-[40%] sm:inset-x-8 sm:bottom-[3%] sm:top-[24%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/vision-poster.jpg" alt="Ten coins over 30 days, each falling through a line 7% under where it started" className="h-full w-full object-contain" />
      </div>
    </Slide>
  );
}
