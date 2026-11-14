"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion/dots";

// a key moment in the terminal: a short dot film over the page, a title, one quiet line. it plays once, then leaves.
// films are in public/moments, rendered from films/baghedge-moments in the video harness, black screened onto the card
export type MomentKind = "connected" | "credited" | "armed" | "filled" | "buyback" | "closed";
export type Moment = { id: number; kind: MomentKind; title: string; line: string };

export function MomentCard({ moment, onDone }: { moment: Moment | null; onDone: () => void }) {
  if (!moment) return null;
  return <Card key={moment.id} m={moment} onDone={onDone} />;
}

function Card({ m, onDone }: { m: Moment; onDone: () => void }) {
  const [still] = useState(reducedMotion);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setLeaving(true);
    timer.current = setTimeout(onDone, still ? 0 : 140);
  }, [onDone, still]);
  const later = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, ms);
  }, [dismiss]);

  // reduced motion shows the poster for less time; otherwise a fallback in case the film never ends (autoplay refused)
  useEffect(() => {
    later(still ? 1800 : 4200);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, [still, later, dismiss]);

  const src = `/moments/${m.kind}`;
  return (
    <div className="pointer-events-none fixed inset-0 z-[65] grid place-items-center p-4">
      <div
        role="status"
        aria-live="polite"
        onClick={dismiss}
        className={`pointer-events-auto flex w-[280px] max-w-full cursor-pointer flex-col items-center rounded-[24px] bg-[#141312] px-6 pb-6 pt-4 text-center ${leaving ? "moment-out" : "moment-in"}`}
      >
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${src}.jpg`} alt="" className="size-[200px]" style={{ mixBlendMode: "screen" }} />
        ) : (
          <video
            src={`${src}.mp4`}
            poster={`${src}.jpg`}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={() => later(2200)}
            className="size-[200px]"
            style={{ mixBlendMode: "screen" }}
          />
        )}
        <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">{m.title}</p>
        <p className="mt-1 text-balance text-[14px] text-white/50 tabular-nums">{m.line}</p>
      </div>
    </div>
  );
}
