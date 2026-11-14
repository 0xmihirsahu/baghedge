"use client";

import { useEffect, useRef } from "react";

// the vision film from the video harness (films/baghedge-vision), drawn live so it stays sharp at any size.
// ten real coins over 30 days of hyperliquid 4h candles, each with a line 7% under where it started.
const W = 1600, H = 900, DUR = 12;
const BG = "#0b0908", DOT = "#ffffff", CORAL = "#f0645a";
const LINE = 0.93;
const COINS = ["BTC", "ETH", "SOL", "HYPE", "NEAR", "XRP", "DOGE", "SUI", "AVAX", "LINK"];
const LOGO: Record<string, string> = { HYPE: "/tokens/HYPE.jpg", NEAR: "/tokens/NEAR.jpg" };
const COLS = 5, PADX = 64, PADY = 64, GAP = 16;
const CW = (W - PADX * 2 - GAP * (COLS - 1)) / COLS, CH = (H - PADY * 2 - 56 - GAP) / 2;
const T_IN = 0.2, T_PLAY = 1.4, T_END = 8.6, T_OUT = 11.2;

type Data = { coins: Record<string, { t: number[]; c: number[] }> };

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const pct = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";

function paint(g: CanvasRenderingContext2D, t: number, data: Data, logos: Record<string, HTMLImageElement>, font: string) {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  COINS.forEach((coin, i) => {
    const s = data.coins[coin].c, n = s.length;
    const x = PADX + (i % COLS) * (CW + GAP), y = PADY + Math.floor(i / COLS) * (CH + GAP);
    const appear = ease((t - T_IN - (i % COLS) * 0.06 - Math.floor(i / COLS) * 0.1) / 0.7);
    const a = appear * (1 - ease((t - T_OUT) / 0.7));
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    g.translate(0, (1 - appear) * 24);

    g.save();
    g.beginPath();
    g.arc(x + 14, y + 16, 14, 0, Math.PI * 2);
    g.clip();
    if (logos[coin]?.complete) g.drawImage(logos[coin], x, y + 2, 28, 28);
    g.restore();
    g.fillStyle = DOT;
    g.font = `600 22px ${font}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(coin, x + 38, y + 17);

    const k = clamp((t - T_PLAY) / (T_END - T_PLAY)) * (n - 1);
    const at = (j: number) => s[Math.min(j, n - 1)];
    const ki = Math.floor(k);
    const now = at(ki) + (at(ki + 1) - at(ki)) * (k - ki);
    const floor = s[0] * LINE;
    g.textAlign = "right";
    g.font = `500 20px ${font}`;
    const kept = pct(Math.max(now, floor) / s[0] - 1);
    g.fillStyle = CORAL;
    g.fillText(kept, x + CW, y + 17);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText(pct(now / s[0] - 1), x + CW - g.measureText(kept).width - 16, y + 17);

    const top = y + 64, bot = y + CH - 18, left = x + 6, right = x + CW - 6;
    const lo = Math.min(...s, floor) * 0.985, hi = Math.max(...s) * 1.01;
    const Y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    const X = (j: number) => left + (j / (n - 1)) * (right - left);
    const fy = Y(floor);

    const lay = ease((t - T_IN - 0.4 - (i % COLS) * 0.05) / 0.9);
    g.fillStyle = CORAL;
    for (let px = left; px <= left + (right - left) * lay; px += 12) {
      g.beginPath();
      g.arc(px, fy, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    let prev: [number, number] | null = null, acc = 0;
    for (let j = 0; j <= Math.min(k, n - 1) + 1e-6; j += 0.25) {
      const jj = Math.min(j, k), ji = Math.floor(jj);
      const v = at(ji) + (at(ji + 1) - at(ji)) * (jj - ji);
      const p: [number, number] = [X(jj), Y(v)];
      if (prev) acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (!prev || acc >= 7) {
        acc = 0;
        const under = v < floor;
        g.fillStyle = under ? "rgba(255,255,255,0.28)" : DOT;
        g.beginPath();
        g.arc(p[0], p[1], under ? 2.2 : 3, 0, Math.PI * 2);
        g.fill();
        if (under) {
          g.fillStyle = CORAL;
          g.beginPath();
          g.arc(p[0], fy, 3.4, 0, Math.PI * 2);
          g.fill();
        }
      }
      prev = p;
    }
    if (t > T_PLAY) {
      g.fillStyle = now < floor ? CORAL : DOT;
      g.beginPath();
      g.arc(X(k), now < floor ? fy : Y(now), 6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });

  const a = ease((t - 0.6) / 0.6) * (1 - ease((t - T_OUT) / 0.7));
  const dates = data.coins.BTC.t;
  const d = new Date(dates[Math.round(clamp((t - T_PLAY) / (T_END - T_PLAY)) * (dates.length - 1))]);
  g.save();
  g.globalAlpha = a;
  g.textBaseline = "middle";
  g.font = `500 20px ${font}`;
  g.textAlign = "left";
  g.fillStyle = DOT;
  g.fillText(d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), PADX, H - PADY);
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText("Hyperliquid, every 4 hours", PADX + 96, H - PADY);
  g.textAlign = "right";
  g.fillStyle = CORAL;
  g.fillText("with a line 7% under", W - PADX, H - PADY);
  const w = g.measureText("with a line 7% under").width;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText("the coin", W - PADX - w - 24, H - PADY);
  g.restore();
}

export function VisionFilm({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const g = el.getContext("2d")!;
    const font = getComputedStyle(document.body).fontFamily;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const logos: Record<string, HTMLImageElement> = {};
    for (const c of COINS) {
      const im = new Image();
      im.src = LOGO[c] ?? `/tokens/${c}.png`;
      logos[c] = im;
    }
    let data: Data | null = null;
    let raf = 0, visible = false, start = -1;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      g.setTransform((el.width / W), 0, 0, el.height / H, 0, 0);
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    fetch("/films/vision-data.json")
      .then((r) => r.json())
      .then((d: Data) => document.fonts.ready.then(() => (data = d)));

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || !data) return;
      if (start < 0) start = now;
      const t = reduced ? T_END : ((now - start) / 1000) % DUR;
      paint(g, t, data, logos, font);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    // contain-fit a 16:9 frame inside whatever box it's given
    <div className={`flex items-center justify-center [container-type:size] ${className ?? ""}`}>
      <canvas
        ref={ref}
        aria-label="Ten coins over 30 days, each falling through a line 7% under where it started"
        className="aspect-video w-[min(100cqw,calc(100cqh*16/9))]"
      />
    </div>
  );
}
