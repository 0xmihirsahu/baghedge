"use client";

// one line under the control that failed. its height is always reserved, so the layout never moves when it appears
export function InlineError({ text, className = "", align = "left" }: { text?: string | null; className?: string; align?: "left" | "center" }) {
  return (
    <p aria-live="polite" className={`h-[18px] truncate text-[12px] leading-[18px] text-[#f2554b] ${align === "center" ? "text-center" : ""} ${className}`}>
      {text ? (
        <span key={text} className="inline-error-in">
          {text}
        </span>
      ) : null}
    </p>
  );
}
