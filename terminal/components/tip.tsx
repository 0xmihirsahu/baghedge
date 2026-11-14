"use client";

import { useId, type ReactNode } from "react";

// a small explainer on hover or keyboard focus. few words: the point is to make a term clear, not to teach.
// it waits a beat before showing (so passing the pointer over doesn't flicker) and leaves at once
export function Tip({ text, children, side = "top", align = "center", className = "" }: { text: string; children: ReactNode; side?: "top" | "bottom"; align?: "start" | "center" | "end"; className?: string }) {
  const id = useId();
  const x = align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";
  const y = side === "top" ? "bottom-full mb-2" : "top-full mt-2";
  return (
    <span className={`group/tip relative inline-flex ${className}`} tabIndex={0} aria-describedby={id}>
      <span className="cursor-help underline decoration-transparent decoration-dotted underline-offset-[3px] transition-[text-decoration-color] duration-150 group-hover/tip:decoration-white/40 group-focus-visible/tip:decoration-white/40">{children}</span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-[80] w-max max-w-[240px] rounded-[10px] bg-[#2e2c2a] px-3 py-2 text-left text-[12px] font-normal leading-snug tracking-normal text-white/90 normal-case opacity-0 transition-opacity duration-100 group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-visible/tip:opacity-100 ${x} ${y}`}
      >
        {text}
      </span>
    </span>
  );
}
