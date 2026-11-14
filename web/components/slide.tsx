"use client";

import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

// a card that slides over the one before it, holds, then shrinks back while the next one slides over it
export function Slide({
  sectionRef,
  recede,
  id,
  z,
  hold = 60,
  children,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  recede?: MotionValue<number>;
  id: string;
  z: string;
  hold?: number;
  children: ReactNode;
}) {
  const zero = useMotionValue(0);
  const scale = useTransform(recede ?? zero, [0, 1], [1, 0.94]);
  const shade = useTransform(recede ?? zero, [0, 1], [0, 0.6]);
  return (
    <section ref={sectionRef} id={id} className={cn("relative -mt-[100svh]", z)} style={{ height: `${200 + hold}svh` }}>
      <div className="sticky top-0 h-svh p-2 sm:p-3">
        <motion.div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]" style={{ scale }}>
          {children}
          <motion.div className="pointer-events-none absolute inset-0 z-30 bg-black" style={{ opacity: shade }} />
        </motion.div>
      </div>
    </section>
  );
}
