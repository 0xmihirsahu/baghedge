"use client";

import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import type { Source } from "@/lib/field";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;
const MARK: Source[] = [{ kind: "image", src: "/art/mascot.webp", scale: 0.7, hot: true }];

const LOGOS = [
  { label: "On black", file: "baghedge-logo-white.png", tile: "bg-coal" },
  { label: "On coral", file: "baghedge-logo-mono-ink.png", tile: "bg-brand" },
  { label: "On light", file: "baghedge-logo-ink.png", tile: "bg-white" },
];

const MARKS = [
  { label: "Mark", file: "baghedge-mark.png", tile: "bg-coal" },
  { label: "Mark, ink", file: "baghedge-mark-ink.png", tile: "bg-brand" },
  { label: "Mark, white", file: "baghedge-mark-white.png", tile: "bg-[#2a2826]" },
];

const ICONS = [
  { label: "Icon", file: "baghedge-icon.png" },
  { label: "Icon, coral", file: "baghedge-icon-coral.png" },
];

const COLOURS = [
  { name: "Black", hex: "#0B0908", use: "Cards", ink: false },
  { name: "Coal", hex: "#1C1B1A", use: "Page", ink: false },
  { name: "Coral", hex: "#F0645A", use: "The only colour", ink: true },
  { name: "White", hex: "#FFFFFF", use: "Dots and type", ink: true },
  { name: "Ink", hex: "#16120F", use: "Type on coral", ink: false },
];

const ART: { name: string; file: string; hot?: boolean }[] = [
  { name: "Bag", file: "bag-hero-a" },
  { name: "Ledger", file: "device" },
  { name: "Coins", file: "coins" },
  { name: "Padlock", file: "padlock" },
  { name: "Falling bag", file: "bag-fall" },
  { name: "Hourglass", file: "hourglass" },
];

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <motion.section
      className={cn("bg-coal rounded-[20px] px-5 pb-6 pt-8 sm:rounded-[24px] sm:px-12 sm:pb-12 sm:pt-12", className)}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      <h2 className="text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">{title}</h2>
      <div className="mt-8 sm:mt-12">{children}</div>
    </motion.section>
  );
}

function Download({ file, dark }: { file: string; dark?: boolean }) {
  return (
    <a
      href={`/brand/${file}`}
      download
      className={cn("text-[14px] underline-offset-4 hover:underline", dark ? "text-[#16120f]/75" : "text-white/70")}
    >
      PNG
    </a>
  );
}

function Swatch({ c }: { c: (typeof COLOURS)[number] }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(c.hex).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "flex aspect-[3/4] flex-col justify-between rounded-[14px] p-4 text-left transition-transform active:scale-[0.98] sm:rounded-[16px] sm:p-5",
        c.ink ? "text-[#16120f]" : "text-white",
        c.hex === "#0B0908" && "ring-1 ring-inset ring-white/10",
      )}
      style={{ backgroundColor: c.hex }}
    >
      <span className="text-[17px] font-semibold sm:text-[20px]">{c.name}</span>
      <span className="text-[13px] sm:text-[14px]">
        <span className="block opacity-70">{c.use}</span>
        <span className="mt-1 block">{copied ? "Copied" : c.hex}</span>
      </span>
    </button>
  );
}

export function BrandPage() {
  return (
    <div className="flex flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <section className="bg-coal relative h-[86svh] min-h-[560px] overflow-hidden rounded-[20px] sm:rounded-[24px]">
        <Header />
        <div className="absolute inset-x-6 bottom-[8%] z-10 sm:left-12 sm:right-auto sm:max-w-[520px]">
          <motion.h1
            className="text-[32px] leading-[1.1] tracking-[-0.02em] sm:text-[48px]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            Brand kit
          </motion.h1>
          <motion.p
            className="mt-3 text-[16px] leading-[1.5] text-white/70 sm:text-[18px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
          >
            The bag, the dots and one coral. Take what you need.
          </motion.p>
          <motion.a
            href="/brand/baghedge-brand.zip"
            download
            className="mt-7 inline-flex rounded-[12px] bg-brand px-5 py-3 text-[15px] font-medium text-white transition-transform active:scale-[0.97]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            Download everything
          </motion.a>
        </div>
        <div className="absolute inset-x-6 top-[90px] h-[44%] sm:inset-x-auto sm:right-[6%] sm:top-[12%] sm:h-[76%] sm:w-[46%]">
          <Field sources={MARK} pitch={[5, 7]} intro hover />
        </div>
      </section>

      <Card title="Logo">
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          {LOGOS.map((l) => (
            <figure key={l.file} className={cn("flex aspect-[4/3] flex-col rounded-[14px] p-4 sm:rounded-[16px] sm:p-5", l.tile, l.tile === "bg-coal" && "ring-1 ring-inset ring-white/10")}>
              <div className="flex flex-1 items-center justify-center px-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/${l.file}`} alt={`baghedge logo, ${l.label.toLowerCase()}`} className="max-h-[56px] w-auto" />
              </div>
              <figcaption className={cn("flex justify-between text-[14px]", l.tile === "bg-coal" ? "text-white/70" : "text-[#16120f]/75")}>
                {l.label}
                <Download file={l.file} dark={l.tile !== "bg-coal"} />
              </figcaption>
            </figure>
          ))}
          {MARKS.map((m) => (
            <figure key={m.file} className={cn("flex aspect-[4/3] flex-col rounded-[14px] p-4 sm:rounded-[16px] sm:p-5", m.tile, m.tile === "bg-coal" && "ring-1 ring-inset ring-white/10")}>
              <div className="flex flex-1 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/${m.file}`} alt={m.label} className="h-[88px] w-auto" />
              </div>
              <figcaption className={cn("flex justify-between text-[14px]", m.tile === "bg-brand" ? "text-[#16120f]/75" : "text-white/70")}>
                {m.label}
                <Download file={m.file} dark={m.tile === "bg-brand"} />
              </figcaption>
            </figure>
          ))}
          {ICONS.map((ic) => (
            <figure key={ic.file} className="flex aspect-[4/3] flex-col rounded-[14px] bg-[#2a2826] p-4 sm:rounded-[16px] sm:p-5">
              <div className="flex flex-1 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/${ic.file}`} alt={ic.label} className="size-[112px] rounded-[26px]" />
              </div>
              <figcaption className="flex justify-between text-[14px] text-white/70">
                {ic.label}
                <Download file={ic.file} />
              </figcaption>
            </figure>
          ))}
        </div>
      </Card>

      <Card title="X">
        <div className="grid gap-2 sm:grid-cols-[1fr_3fr] sm:gap-3">
          <figure className="flex flex-col rounded-[14px] bg-[#2a2826] p-4 sm:rounded-[16px] sm:p-5">
            <div className="flex flex-1 items-center justify-center py-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/baghedge-x-avatar.png" alt="baghedge profile picture for X" className="size-[140px] rounded-full" />
            </div>
            <figcaption className="flex justify-between text-[14px] text-white/70">
              Profile, 400 × 400
              <Download file="baghedge-x-avatar.png" />
            </figcaption>
          </figure>
          <figure className="flex flex-col rounded-[14px] bg-[#2a2826] p-4 sm:rounded-[16px] sm:p-5">
            <div className="flex flex-1 items-center justify-center py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/baghedge-x-header.png" alt="baghedge header for X" className="w-full rounded-[10px]" />
            </div>
            <figcaption className="mt-3 flex justify-between text-[14px] text-white/70">
              <a href="https://x.com/baghedge" target="_blank" rel="noopener noreferrer" className="hover:text-white">
                Header, 1500 × 500 · @baghedge
              </a>
              <Download file="baghedge-x-header.png" />
            </figcaption>
          </figure>
        </div>
      </Card>

      <Card title="Colour">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          {COLOURS.map((c) => (
            <Swatch key={c.hex} c={c} />
          ))}
        </div>
      </Card>

      <Card title="Type">
        <div className="grid gap-10 sm:grid-cols-[auto_1fr] sm:items-end sm:gap-16">
          <p className="text-[120px] leading-[0.9] tracking-[-0.04em] sm:text-[200px]">Aa</p>
          <div>
            <p className="text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[40px]">Trade perps. Hedge your bag.</p>
            <p className="mt-6 text-[15px] leading-[1.6] text-white/70">
              Figtree, at 400 for headlines and text, 500 for small labels, 600 for names and the wordmark. Free on{" "}
              <a href="https://fonts.google.com/specimen/Figtree" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">
                Google Fonts
              </a>
              .
            </p>
          </div>
        </div>
      </Card>

      <Card title="Art">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          {ART.map((a) => (
            <figure key={a.file} className="flex aspect-square flex-col rounded-[14px] bg-[#151413] p-4 sm:rounded-[16px] sm:p-5">
              <div className="flex-1">
                <Field sources={[{ kind: "image", src: `/art/${a.file}.webp`, scale: 0.8, hot: a.hot }]} pitch={[4, 5]} intro hover />
              </div>
              <figcaption className="mt-3 flex justify-between text-[14px] text-white/70">
                {a.name}
                <Download file={`art/${a.file}.png`} />
              </figcaption>
            </figure>
          ))}
        </div>
      </Card>

    </div>
  );
}
