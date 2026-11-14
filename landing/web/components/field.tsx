"use client";

import { useEffect, useRef, useState } from "react";
import { build, empty, hash, type Layer, type Source } from "@/lib/field";
import { cn } from "@/lib/utils";

const GLYPHS = "$#%&*+=/\\<>?!0123456789";
const DOT = "#ffffff";
const DIM = "#3a3633";
const HOT = "#f0645a";
const WIPE = 0.12;

type Live = {
  layers: Layer[];
  none: Layer | null;
  thr: Float32Array;
  cols: number;
  rows: number;
  pitch: number;
  w: number;
  h: number;
  pointer: { x: number; y: number } | null;
  visible: boolean;
  introAt: number;
  dirty: boolean;
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// a grid of halftone dots. moving between layers, a band of glyphs sweeps across and settles into the next object
export function Field({
  sources,
  at,
  pitch,
  intro,
  hover,
  dim,
  color = DOT,
  accent = HOT,
  square,
  morph = [0.35, 0.75],
  className,
}: {
  sources: Source[];
  color?: string;
  accent?: string;
  square?: boolean;
  morph?: [number, number];
  at?: () => number;
  pitch: [number, number];
  intro?: boolean;
  hover?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const atRef = useRef(at);
  const [m0, m1] = morph;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const live = useRef<Live>({
    layers: [],
    none: null,
    thr: new Float32Array(0),
    cols: 0,
    rows: 0,
    pitch: 8,
    w: 0,
    h: 0,
    pointer: null,
    visible: false,
    introAt: -1,
    dirty: true,
  });

  useEffect(() => {
    atRef.current = at;
  }, [at]);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // rebuild the tone grids when the frame or the content changes
  useEffect(() => {
    if (!size || !size.w || !size.h) return;
    let gone = false;
    const p = size.w < 640 ? pitch[0] : pitch[1];
    const grid = { cols: Math.floor(size.w / p), rows: Math.floor(size.h / p) };
    const el = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    el.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const family = getComputedStyle(document.body).fontFamily;
    document.fonts.ready
      .then(() => build(sources, grid, family))
      .then((layers) => {
        if (gone) return;
        const L = live.current;
        const thr = new Float32Array(grid.cols * grid.rows);
        for (let i = 0; i < thr.length; i++) thr[i] = 0.62 * ((i % grid.cols) / grid.cols) + 0.38 * hash(i, 7);
        Object.assign(L, { layers, none: empty(grid), thr, ...grid, pitch: p, w: size.w, h: size.h, dirty: true });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [size, sources, pitch]);

  useEffect(() => {
    const el = ref.current!;
    const ctx = el.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const family = getComputedStyle(document.body).fontFamily;
    const L = live.current;
    let raf = 0;
    let lastS = -1;
    let lastDraw = 0;

    const io = new IntersectionObserver(([e]) => {
      L.visible = e.isIntersecting;
    });
    io.observe(el);

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      // the canvas may be scaled by a parent transform, so map back to its own pixels
      L.pointer = { x: ((e.clientX - r.left) * (L.w / r.width)) / L.pitch, y: ((e.clientY - r.top) * (L.h / r.height)) / L.pitch };
      L.dirty = true;
    };
    const leave = () => {
      L.pointer = null;
      L.dirty = true;
    };
    if (hover) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!L.visible || !L.layers.length || !L.none) return;
      const s = atRef.current?.() ?? 0;
      if (intro && L.introAt < 0) L.introAt = reduced || s > m0 ? 0 : now;
      const introT = L.introAt > 0 ? clamp((now - L.introAt) / 1800) : 1;
      const busy = s !== lastS || introT < 1 || L.dirty;
      // idle frames only need the glyph flicker, so draw them at a film-ish rate
      if (!busy && now - lastDraw < 90) return;
      lastS = s;
      lastDraw = now;
      L.dirty = false;

      const n = L.layers.length;
      let A: Layer, B: Layer, t: number;
      if (introT < 1) {
        A = L.none;
        B = L.layers[0];
        t = smooth(introT);
      } else {
        const i = clamp(Math.floor(s), 0, n - 1);
        A = L.layers[i];
        B = L.layers[Math.min(i + 1, n - 1)];
        t = smooth(clamp((s - i - m0) / (m1 - m0)));
      }

      const { cols, rows, pitch: p, thr, pointer } = L;
      const T = t * (1 + 2 * WIPE) - WIPE;
      const R = p * (square ? 0.47 : 0.56);
      const tickG = Math.floor(now / 70);
      const white = new Path2D();
      const red = new Path2D();
      const gi: number[] = [];
      const gk: number[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          const a = A.tone[k], b = B.tone[k];
          if (a === 0 && b === 0) continue;
          const d = (T - thr[k]) / WIPE;
          const tone = d < 0 ? a : b;
          const hot = d < 0 ? A.hot[k] : B.hot[k];
          let kind = 0;
          if (!reduced && d > -1 && d < 1) kind = 1;
          if (pointer && !reduced) {
            const dx = c + 0.5 - pointer.x, dy = r + 0.5 - pointer.y;
            if (dx * dx + dy * dy < 20) kind = 1;
          }
          if (kind) {
            gi.push(k);
            gk.push(kind);
            continue;
          }
          const rad = Math.sqrt(tone) * R;
          if (rad < 0.45) continue;
          const x = (c + 0.5) * p, y = (r + 0.5) * p;
          const path = hot ? red : white;
          if (square) path.rect(x - rad, y - rad, rad * 2, rad * 2);
          else {
            path.moveTo(x + rad, y);
            path.arc(x, y, rad, 0, Math.PI * 2);
          }
        }
      }

      ctx.clearRect(0, 0, L.w, L.h);
      ctx.fillStyle = dim ? DIM : color;
      ctx.fill(white);
      ctx.fillStyle = accent;
      ctx.fill(red);
      if (gi.length) {
        ctx.font = `600 ${p * 1.25}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let j = 0; j < gi.length; j++) {
          const k = gi[j];
          ctx.fillStyle = gk[j] === 1 ? accent : color;
          ctx.globalAlpha = gk[j] === 1 ? 1 : 0.5;
          ctx.fillText(GLYPHS[Math.floor(hash(k, tickG) * GLYPHS.length)], ((k % cols) + 0.5) * p, (Math.floor(k / cols) + 0.5) * p);
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [intro, hover, dim, m0, m1, color, accent, square]);

  return <canvas ref={ref} aria-hidden className={cn("block h-full w-full", className)} />;
}
