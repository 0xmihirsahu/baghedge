"use client";

import { useEffect, useState } from "react";
import { BagLoader, LogoReveal, RuleLines, StatusText } from "@/components/motion";

// the hedge states from docs/BAGHEDGE_CONTEXT.md, in the order a rule goes through them
const STATES = ["Awaiting signature", "Deposit detected", "In transit", "Credited", "Armed", "Entry pending", "Recovery stop active", "Closing"];

function Tile({ label, children, onClick, action }: { label: string; children: React.ReactNode; onClick?: () => void; action?: string }) {
  return (
    <figure className="flex aspect-[16/9] flex-col rounded-[14px] bg-[#151413] p-4 sm:rounded-[16px] sm:p-5">
      <div className="relative flex flex-1 items-center justify-center">{children}</div>
      <figcaption className="mt-3 flex justify-between text-[14px] text-white/70">
        {label}
        {action && (
          <button onClick={onClick} className="underline-offset-4 hover:text-white hover:underline">
            {action}
          </button>
        )}
      </figcaption>
    </figure>
  );
}

// the app's motion kit (components/motion), running live
export function MotionDemo() {
  const [play, setPlay] = useState(0);
  const [i, setI] = useState(0);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const a = setInterval(() => setI((v) => (v + 1) % STATES.length), 1700);
    const b = setInterval(() => setArmed((v) => !v), 3200);
    const first = setTimeout(() => setArmed(true), 600);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearTimeout(first);
    };
  }, []);

  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
      <Tile label="BagLoader, 16 · 32 · 64 px">
        <div className="flex items-end gap-10">
          <BagLoader size={16} />
          <BagLoader size={32} />
          <BagLoader size={64} />
        </div>
      </Tile>
      <Tile label="LogoReveal" action="Replay" onClick={() => setPlay((v) => v + 1)}>
        <LogoReveal size={72} play={play} />
      </Tile>
      <Tile label="StatusText">
        <StatusText text={STATES[i]} className="text-[28px] tracking-[-0.01em] sm:text-[34px]" />
      </Tile>
      <Tile label="RuleLines" action={armed ? "Disarm" : "Arm"} onClick={() => setArmed((v) => !v)}>
        <div className="absolute inset-0">
          <RuleLines armed={armed} chip="#151413" recovery={{ y: 60, label: "Try to close at $78.18" }} entry={{ y: 130, label: "Short opens below $67.98" }} />
        </div>
      </Tile>
    </div>
  );
}
