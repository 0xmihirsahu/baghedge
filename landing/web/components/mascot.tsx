import { cn } from "@/lib/utils";

// the red bag, our phantom ghost. sits inside headlines and next to the wordmark
export function Mascot({ variant = "red", className }: { variant?: "red" | "peek" | "ink"; className?: string }) {
  const src = variant === "peek" ? "/art/mascot-peek.webp" : variant === "ink" ? "/art/mascot-ink.webp" : "/art/mascot.webp";
  return <img src={src} alt="" aria-hidden className={cn("inline-block select-none", className)} />;
}
