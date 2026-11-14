"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BagLoader, ExposureDots, LogoReveal, NumberRoll, RuleLines, StatusText, TransferTrack } from "@/components/motion";
import { ArrowLeft } from "@phosphor-icons/react";
import { STATUS, type Phase } from "./app/store";
import { DOWN, UP, usd } from "./app/format";
import { NavLab } from "./nav-lab";

// a gallery of every animation in the terminal, live, with the real components and demo values
export function Animations() {
  return (
    <div className="min-h-svh bg-[#0b0908] pb-16">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-4 pt-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mascot.webp" alt="" className="size-6" />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">baghedge</span>
        </Link>
        <Link href="/" className="flex items-center gap-2 text-[14px] font-medium text-white/55 transition-colors hover:text-white">
          <ArrowLeft size={16} />
          Terminal
        </Link>
      </header>
      <div className="mx-auto max-w-[1240px] px-4 pt-10 sm:px-6">
        <h1 className="text-[34px] font-semibold leading-none tracking-[-0.03em]">Animations</h1>
        <p className="mt-3 text-[15px] text-white/50">Every motion in the terminal, live. Demo values.</p>
        <div className="mt-8">
          <NavLab />
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Loader />
          <Reveal />
          <Status />
          <Rule />
          <Transfer />
          <Exposure />
          <Roll />
          <Flash />
          <Toasts />
        </div>
      </div>
    </div>
  );
}

function Card({ title, line, stage, controls, stageClass = "grid place-items-center" }: { title: string; line: string; stage: ReactNode; controls?: ReactNode; stageClass?: string }) {
  return (
    <section className="flex flex-col rounded-[20px] bg-[#141312] p-5">
      <div className={`relative h-[184px] ${stageClass}`}>{stage}</div>
      <h2 className="mt-4 text-[16px] font-semibold">{title}</h2>
      <p className="mt-1 text-[14px] leading-snug text-white/50">{line}</p>
      {controls && <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">{controls}</div>}
    </section>
  );
}

function Btn({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-[10px] px-3.5 text-[13px] font-semibold transition-colors duration-150 active:scale-[0.97] ${on ? "bg-[#2e2c2a] text-white" : "bg-[#1c1b1a] text-white/60 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#f0645a] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#2e2c2a] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[#2e2c2a] [&::-webkit-slider-thumb]:-mt-[6px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f0645a]"
    />
  );
}

// runs `tick` every `ms` while `on`
function useEvery(on: boolean, ms: number, tick: () => void) {
  const fn = useRef(tick);
  useEffect(() => {
    fn.current = tick;
  });
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => fn.current(), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

function Loader() {
  const [size, setSize] = useState(48);
  return (
    <Card
      title="Bag loader"
      line="Markets, candles and balances while live data loads."
      stage={<BagLoader key={size} size={size} />}
      controls={([["Small", 18], ["Medium", 48], ["Large", 96]] as const).map(([k, v]) => (
        <Btn key={k} on={size === v} onClick={() => setSize(v)}>{k}</Btn>
      ))}
    />
  );
}

function Reveal() {
  const [play, setPlay] = useState(0);
  return (
    <Card
      title="Logo reveal"
      line="The first-load splash, while the terminal starts up."
      stage={<LogoReveal size={56} play={play} />}
      controls={<Btn onClick={() => setPlay((p) => p + 1)}>Replay</Btn>}
    />
  );
}

const PHASES = Object.keys(STATUS) as Phase[];

function Status() {
  const [i, setI] = useState(PHASES.indexOf("armed"));
  const [auto, setAuto] = useState(false);
  const next = () => setI((v) => (v + 1) % PHASES.length);
  useEvery(auto, 1500, next);
  return (
    <Card
      title="Status text"
      line="Toasts, ticket and positions: the hedge just changed state."
      stage={
        <div className="text-center">
          <StatusText text={STATUS[PHASES[i]]} className="text-[26px] font-semibold tracking-[-0.02em]" />
          <p className="mt-2 text-[13px] text-white/40 tabular-nums">{i + 1} / {PHASES.length}</p>
        </div>
      }
      controls={
        <>
          <Btn onClick={() => setI((v) => (v - 1 + PHASES.length) % PHASES.length)}>Prev</Btn>
          <Btn onClick={next}>Next</Btn>
          <Btn on={auto} onClick={() => setAuto((a) => !a)}>{auto ? "Pause" : "Play"}</Btn>
        </>
      }
    />
  );
}

// stage pixels to a demo SOL price, so the labels move with the lines
const price = (y: number) => (210 - y * 0.25).toFixed(2);

function Rule() {
  const [mode, setMode] = useState<"Off" | "Editing" | "Armed">("Editing");
  const [entry, setEntry] = useState(128);
  const [recovery, setRecovery] = useState(62);
  const clamp = (y: number) => Math.max(36, Math.min(176, Math.round(y)));
  return (
    <Card
      title="Rule lines"
      line="The hedge rule on the SOL chart: faint while drafting, printed in once armed."
      stageClass=""
      stage={
        <RuleLines
          armed={mode === "Armed"}
          editing={mode === "Editing"}
          entry={{ y: entry, label: `Short opens below $${price(entry)}`, onDrag: (y) => setEntry(Math.max(clamp(y), recovery + 30)) }}
          recovery={{ y: recovery, label: `Try to close at $${price(recovery)}`, onDrag: (y) => setRecovery(Math.min(clamp(y), entry - 30)) }}
          chip="#141312"
        />
      }
      controls={(["Off", "Editing", "Armed"] as const).map((m) => (
        <Btn key={m} on={mode === m} onClick={() => setMode(m)}>{m}</Btn>
      ))}
    />
  );
}

// the app's funding timings, from AUTO in the store
const STEP_MS = [1300, 1200, 2600];

function Transfer() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    if (step >= 3) {
      const t = setTimeout(() => setAuto(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS[step]);
    return () => clearTimeout(t);
  }, [auto, step]);
  return (
    <Card
      title="Transfer track"
      line="Hedge ticket: margin moving from Base to Hyperliquid, step by step."
      stage={<TransferTrack step={step} amount="120 USDC" className="w-full" />}
      controls={
        <>
          {[1, 2, 3, 4].map((n) => (
            <Btn key={n} on={step === n - 1} onClick={() => { setAuto(false); setStep(n - 1); }}>{n}</Btn>
          ))}
          <Btn onClick={() => { setStep(0); setAuto(true); }}>Play</Btn>
        </>
      }
    />
  );
}

function Exposure() {
  const [cover, setCover] = useState(60);
  const watched = 10;
  return (
    <Card
      title="Exposure dots"
      line="Ticket and portfolio: your SOL in white, the hedged share in coral."
      stage={
        <div className="flex flex-col items-center gap-4">
          <ExposureDots watched={watched} hedged={-(watched * cover) / 100} per={watched / 20} size={14} className="w-[203px]" />
          <p className="text-[13px] text-white/45 tabular-nums">
            {cover > 100 ? "Buyback pending" : <>Covers <span className="text-white">{cover}%</span> of your SOL</>}
          </p>
        </div>
      }
      controls={<Slider label="Coverage" value={cover} min={0} max={150} step={5} onChange={setCover} />}
    />
  );
}

function Roll() {
  const [value, setValue] = useState(184.62);
  return (
    <Card
      title="Number roll"
      line="Prices, balances and the short's size roll to each new value."
      stage={<NumberRoll value={value} format={(n) => usd(n, 2)} className="text-[44px] font-semibold leading-none tracking-[-0.03em]" />}
      controls={
        <>
          <Slider label="Value" value={value} min={100} max={260} step={0.01} onChange={setValue} />
          <Btn onClick={() => setValue(Math.round((100 + Math.random() * 160) * 100) / 100)}>Jump</Btn>
        </>
      }
    />
  );
}

type Row = { id: number; side: "B" | "A"; sz: number; px: number; at: string; fresh: boolean };
const SEED: Row[] = [
  { id: 4, side: "B", sz: 12.4, px: 184.62, at: "14:02:11", fresh: false },
  { id: 3, side: "A", sz: 3.08, px: 184.6, at: "14:02:09", fresh: false },
  { id: 2, side: "A", sz: 40.2, px: 184.59, at: "14:02:06", fresh: false },
  { id: 1, side: "B", sz: 0.75, px: 184.61, at: "14:02:02", fresh: false },
  { id: 0, side: "B", sz: 6.1, px: 184.58, at: "14:01:58", fresh: false },
];

function Flash() {
  const [rows, setRows] = useState(SEED);
  const [auto, setAuto] = useState(false);
  const add = (side?: "B" | "A") =>
    setRows((v) => {
      const s = side ?? (Math.random() < 0.5 ? "B" : "A");
      const px = Math.round((v[0].px + (s === "B" ? 0.01 : -0.01) * Math.ceil(Math.random() * 3)) * 100) / 100;
      const row = { id: v[0].id + 1, side: s, sz: Math.round(Math.random() * 3000) / 100, px, at: new Date().toLocaleTimeString("en-GB"), fresh: true };
      return [row, ...v.slice(0, 4)];
    });
  useEvery(auto, 650, () => add());
  return (
    <Card
      title="Trade flash"
      line="The live tape: each new trade slides in and flashes its side."
      stageClass="overflow-hidden -mx-5"
      stage={rows.map((t) => (
        <div
          key={t.id}
          className={`grid grid-cols-[1fr_auto_72px] items-center gap-4 px-5 py-[6px] text-[14px] tabular-nums ${t.fresh ? "row-in" : ""}`}
          style={{ ["--flash" as string]: t.side === "B" ? "rgb(62 207 142 / 0.14)" : "rgb(242 85 75 / 0.14)" }}
        >
          <span style={{ color: t.side === "B" ? UP : DOWN }}>{t.sz.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL</span>
          <span>{t.px.toFixed(2)}</span>
          <span className="text-right text-white/40">{t.at}</span>
        </div>
      ))}
      controls={
        <>
          <Btn onClick={() => add("B")}>Buy</Btn>
          <Btn onClick={() => add("A")}>Sell</Btn>
          <Btn on={auto} onClick={() => setAuto((a) => !a)}>{auto ? "Pause" : "Stream"}</Btn>
        </>
      }
    />
  );
}

const TOASTS: { title: string; status: string; kind: "replay" | "error" | "info" }[] = [
  { title: "Short", status: "Filled", kind: "replay" },
  { title: "Deposit", status: "Credited", kind: "replay" },
  { title: "Wallet", status: "Connection cancelled", kind: "error" },
  { title: "Hedge", status: "Closed", kind: "replay" },
];

function Toasts() {
  const [list, setList] = useState<{ id: number; n: number }[]>([]);
  const count = useRef(0);
  const show = () => {
    const id = ++count.current;
    setList((v) => [...v.slice(-2), { id, n: (id - 1) % TOASTS.length }]);
    setTimeout(() => setList((v) => v.filter((x) => x.id !== id)), 3200);
  };
  return (
    <Card
      title="Toast"
      line="Top right: every replay event and wallet error drops in here."
      stageClass="flex flex-col items-center gap-2 pt-1"
      stage={list.map(({ id, n }) => {
        const t = TOASTS[n];
        return (
          <div key={id} className="toast-in flex w-[260px] items-center gap-3 rounded-[14px] bg-[#1c1b1a] px-4 py-3">
            <span className="text-[13px] text-white/50">{t.kind === "replay" ? `Replay · ${t.title}` : t.title}</span>
            <StatusText text={t.status} className="text-[15px] font-medium" />
            {t.kind === "error" && <span className="ml-auto size-2 shrink-0 rounded-full" style={{ background: DOWN }} />}
          </div>
        );
      })}
      controls={<Btn onClick={show}>Show toast</Btn>}
    />
  );
}
