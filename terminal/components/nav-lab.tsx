"use client";

import { ChartBar, ChartLine, ClockCounterClockwise, Handbag, Wallet, type Icon } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { CORAL } from "./app/format";

// four nav designs to try by hand: hover them, click them, pick one for the app
const ITEMS: { label: string; fill: Icon; line: Icon }[] = [
  { label: "Markets", fill: ChartBar, line: ChartLine },
  { label: "Hedge", fill: Handbag, line: Handbag },
  { label: "Portfolio", fill: Wallet, line: Wallet },
  { label: "Activity", fill: ClockCounterClockwise, line: ClockCounterClockwise },
];

export function NavLab() {
  return (
    <section>
      <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Nav, pick one</h2>
      <p className="mt-1 text-[14px] text-white/50">Hover and click each. Tell me the letter.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Variant letter="A" name="Quiet" line="Colour only, no motion. Stays out of the way.">
          {(on, set) => <Quiet on={on} set={set} />}
        </Variant>
        <Variant letter="B" name="Coral rail" line="A thin coral bar slides to the page. Line icons.">
          {(on, set) => <Rail on={on} set={set} />}
        </Variant>
        <Variant letter="C" name="Glide" line="A highlight follows the pointer; the coral tile slides on click.">
          {(on, set) => <Glide on={on} set={set} />}
        </Variant>
        <Variant letter="D" name="Halftone" line="Coral dots rise through the tile on hover.">
          {(on, set) => <Halftone on={on} set={set} />}
        </Variant>
      </div>
    </section>
  );
}

function Variant({ letter, name, line, children }: { letter: string; name: string; line: string; children: (on: number, set: (i: number) => void) => React.ReactNode }) {
  const [on, setOn] = useState(1);
  return (
    <div className="flex flex-col rounded-[20px] bg-[#141312] p-5">
      <div className="rounded-[14px] bg-[#0b0908] p-3">
        <LayoutGroup id={letter}>{children(on, setOn)}</LayoutGroup>
      </div>
      <p className="mt-4 text-[16px] font-semibold">
        <span className="mr-2 inline-grid size-6 place-items-center rounded-[7px] bg-[#2e2c2a] text-[13px]">{letter}</span>
        {name}
      </p>
      <p className="mt-1 text-[14px] leading-snug text-white/50">{line}</p>
    </div>
  );
}

type Props = { on: number; set: (i: number) => void };

// A: the tile lightens and the label turns white in 120 ms; the active tile is coral, no movement
function Quiet({ on, set }: Props) {
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it, i) => (
        <button key={it.label} onClick={() => set(i)} className={`group flex items-center gap-3 rounded-[12px] px-2 py-2 text-[15px] font-semibold transition-colors duration-[120ms] ${on === i ? "text-white" : "text-white/55 hover:text-white"}`}>
          <span className={`grid size-[30px] place-items-center rounded-[9px] transition-colors duration-[120ms] ${on === i ? "bg-[#f0645a]" : "bg-[#1c1b1a] group-hover:bg-[#2e2c2a]"}`}>
            <it.fill size={17} weight="fill" className={on === i ? "text-white" : "text-white/70 group-hover:text-white"} />
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

// B: plain line icons; a 3px coral bar on the left edge slides to the active row
function Rail({ on, set }: Props) {
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it, i) => (
        <button key={it.label} onClick={() => set(i)} className={`relative flex items-center gap-3 rounded-[10px] py-2.5 pl-4 pr-2 text-[15px] font-semibold transition-colors duration-150 ${on === i ? "text-white" : "text-white/50 hover:text-white/85"}`}>
          {on === i && <motion.span layoutId="rail" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: CORAL }} transition={{ type: "spring", duration: 0.28, bounce: 0 }} />}
          <it.line size={19} weight={on === i ? "bold" : "regular"} />
          {it.label}
        </button>
      ))}
    </nav>
  );
}

// C: one dark highlight glides under the pointer; the coral tile slides the moment you click
function Glide({ on, set }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <nav className="flex flex-col gap-1" onMouseLeave={() => setHover(null)}>
      {ITEMS.map((it, i) => (
        <button key={it.label} onMouseEnter={() => setHover(i)} onClick={() => set(i)} className={`relative flex items-center gap-3 rounded-[12px] px-2 py-2 text-[15px] font-semibold transition-colors duration-150 ${on === i || hover === i ? "text-white" : "text-white/55"}`}>
          {hover === i && <motion.span layoutId="hover" className="absolute inset-0 rounded-[12px] bg-[#1c1b1a]" transition={{ type: "spring", duration: 0.18, bounce: 0 }} />}
          <span className="relative grid size-[30px] place-items-center rounded-[9px] bg-[#1c1b1a]">
            {on === i && <motion.span layoutId="tile" className="absolute inset-0 rounded-[9px]" style={{ background: CORAL }} transition={{ type: "spring", duration: 0.22, bounce: 0 }} />}
            <it.fill size={17} weight="fill" className="relative text-white" />
          </span>
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

// D: coral halftone dots rise through the tile on hover; active is solid coral
function Halftone({ on, set }: Props) {
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it, i) => (
        <button key={it.label} onClick={() => set(i)} className={`group flex items-center gap-3 rounded-[12px] px-2 py-2 text-[15px] font-semibold transition-colors duration-150 ${on === i ? "text-white" : "text-white/55 hover:text-white"}`}>
          <span className="relative grid size-[30px] place-items-center overflow-hidden rounded-[9px]" style={{ background: on === i ? CORAL : "#1c1b1a" }}>
            {on !== i && (
              <span
                aria-hidden
                className="absolute inset-0 transition-[clip-path] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] [clip-path:inset(100%_0_0_0)] group-hover:[clip-path:inset(0_0_0_0)]"
                style={{ backgroundImage: "radial-gradient(circle, #f0645a 1px, transparent 1.4px)", backgroundSize: "4px 4px", backgroundPosition: "center" }}
              />
            )}
            <it.fill size={17} weight="fill" className={`relative ${on === i ? "text-white" : "text-white/70 group-hover:text-white"}`} />
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
