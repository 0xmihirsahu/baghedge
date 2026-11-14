"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

// a title that rises word by word out of a mask, then the rest fades in under it
export function Copy({
  state,
  title,
  hero,
  children,
}: {
  state: "in" | "up" | "down";
  title: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  const words = title.split(" ");
  const on = state === "in";
  return (
    <div
      className={
        (hero ? "flex flex-col items-center text-center" : "absolute inset-x-0 top-0") + (on ? "" : " pointer-events-none")
      }
      aria-hidden={!on}
    >
      <h2
        className={
          hero
            ? "max-w-[15.5ch] text-[28px] leading-[1.15] tracking-[-0.02em] text-white sm:text-[36px]"
            : "text-[28px] leading-[1.14] tracking-[-0.02em] text-white sm:text-[40px]"
        }
      >
        {words.map((w, i) => (
          <span key={i}>
            <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-top">
              <motion.span
                className="inline-block"
                initial={{ y: "110%" }}
                animate={{ y: on ? "0%" : state === "up" ? "-110%" : "110%" }}
                transition={{ duration: 0.8, ease: EASE, delay: on ? 0.08 + i * 0.035 : i * 0.012 }}
              >
                {w}
              </motion.span>
            </span>
            {i < words.length - 1 && " "}
          </span>
        ))}
      </h2>
      {children && (
        <motion.div
          className={(hero ? "mt-4 max-w-[380px] text-[15px] sm:text-[16px]" : "mt-5 max-w-[420px] text-[16px] sm:text-[18px]") + " leading-[1.5] text-white/75"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: on ? 1 : 0, y: on ? 0 : 10 }}
          transition={{ duration: 0.6, ease: EASE, delay: on ? 0.35 : 0 }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}
