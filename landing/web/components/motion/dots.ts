import { MARK_COLS, MARK_ROWS, MARK_TONE } from "./mark-grid";

// shared by the motion kit: the mark as a tone grid, drawn as round dots, with coral glyphs where it's "decoding"

export const GLYPHS = "$#%&*+=/\\<>?!0123456789";
export const CORAL = "#f0645a";
export const WHITE = "#ffffff";

export type Grid = { cols: number; rows: number; tone: Float32Array };

const base: Grid = {
  cols: MARK_COLS,
  rows: MARK_ROWS,
  tone: Float32Array.from(MARK_TONE, (ch) => Number(ch) / 9),
};

// at small sizes the dots would be sub-pixel, so merge blocks of cells until each dot is at least `min` px
export function markGrid(heightPx: number, min = 2.6): Grid {
  let g = base;
  while (heightPx / g.rows < min && g.rows > 6) {
    const cols = Math.ceil(g.cols / 2), rows = Math.ceil(g.rows / 2);
    const tone = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let s = 0, n = 0;
        for (let dr = 0; dr < 2; dr++)
          for (let dc = 0; dc < 2; dc++) {
            const rr = r * 2 + dr, cc = c * 2 + dc;
            if (rr < g.rows && cc < g.cols) { s += g.tone[rr * g.cols + cc]; n++; }
          }
        tone[r * cols + c] = n ? s / n : 0;
      }
    g = { cols, rows, tone };
  }
  return g;
}

export function hash(a: number, b: number) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// size a canvas for the device pixel ratio and return its 2d context in css pixels
export function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

type DrawOpts = {
  color: string;
  glyph: string;
  // per cell: return "dot", "glyph" or "none"
  state: (col: number, row: number, i: number) => "dot" | "glyph" | "none";
  tick: number;
};

export function drawMark(ctx: CanvasRenderingContext2D, g: Grid, w: number, h: number, o: DrawOpts) {
  ctx.clearRect(0, 0, w, h);
  const p = h / g.rows, R = p * 0.56, left = (w - g.cols * p) / 2;
  const glyphs: number[] = [];
  ctx.fillStyle = o.color;
  ctx.beginPath();
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c, v = g.tone[i];
      if (v < 0.08) continue;
      const s = o.state(c, r, i);
      if (s === "none") continue;
      const x = left + (c + 0.5) * p, y = (r + 0.5) * p;
      if (s === "glyph") { glyphs.push(x, y, i); continue; }
      const rad = Math.sqrt(v) * R;
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
  ctx.fill();
  if (!glyphs.length) return;
  ctx.fillStyle = o.glyph;
  // glyphs only read from about 6 px a cell; below that the band is drawn as dots in the glyph colour
  if (p < 6) {
    ctx.beginPath();
    for (let j = 0; j < glyphs.length; j += 3) { ctx.moveTo(glyphs[j] + R, glyphs[j + 1]); ctx.arc(glyphs[j], glyphs[j + 1], R, 0, Math.PI * 2); }
    ctx.fill();
    return;
  }
  ctx.font = `600 ${p * 1.25}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let j = 0; j < glyphs.length; j += 3) ctx.fillText(GLYPHS[Math.floor(hash(glyphs[j + 2], o.tick) * GLYPHS.length)], glyphs[j], glyphs[j + 1]);
}
