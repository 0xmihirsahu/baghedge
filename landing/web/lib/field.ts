// turns art, a price line or a word into a grid of tones, one per cell, for the dot field

export type Grid = { cols: number; rows: number };
export type Layer = { tone: Float32Array; hot: Uint8Array };
export type Source =
  | { kind: "image"; src: string; scale?: number; y?: number; hot?: boolean }
  | { kind: "chart"; closes: number[]; line: number }
  | { kind: "text"; text: string }
  | { kind: "empty" };

const images = new Map<string, Promise<HTMLImageElement>>();
const boxes = new WeakMap<HTMLImageElement, { x: number; y: number; w: number; h: number }>();

export function loadImage(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
    images.set(src, p);
  }
  return p;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement) {
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  return x;
}

export function empty({ cols, rows }: Grid): Layer {
  return { tone: new Float32Array(cols * rows), hot: new Uint8Array(cols * rows) };
}

// the opaque area of the art, so every object fills the frame the same way
function bbox(img: HTMLImageElement) {
  const hit = boxes.get(img);
  if (hit) return hit;
  const s = 256 / Math.max(img.naturalWidth, img.naturalHeight);
  const c = canvas(img.naturalWidth * s, img.naturalHeight * s);
  const x = ctx2d(c);
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let i = 0; i < c.width; i++)
      if (d[(y * c.width + i) * 4 + 3] > 24) {
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const box = x1 < x0 ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight } : { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
  boxes.set(img, box);
  return box;
}

// halve step by step so the source's own dots average into tone instead of aliasing
function shrink(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number) {
  let cur = src, cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 > w * 1.4 && ch / 2 > h * 1.4) {
    const c = canvas(cw / 2, ch / 2);
    ctx2d(c).drawImage(cur, cx, cy, cw, ch, 0, 0, c.width, c.height);
    cur = c;
    cx = 0;
    cy = 0;
    cw = c.width;
    ch = c.height;
  }
  return { cur, cx, cy, cw, ch };
}

function readAlpha(c: HTMLCanvasElement, grid: Grid, layer: Layer, hot: boolean) {
  const d = ctx2d(c).getImageData(0, 0, grid.cols, grid.rows).data;
  const vals: number[] = [];
  for (let i = 0; i < layer.tone.length; i++) {
    const a = d[i * 4 + 3] / 255;
    layer.tone[i] = a;
    if (a > 0.02) vals.push(a);
  }
  // stretch so the densest part of every object lands on full dots
  vals.sort((a, b) => a - b);
  const top = vals.length ? Math.max(vals[Math.floor(vals.length * 0.96)], 0.2) : 1;
  for (let i = 0; i < layer.tone.length; i++) {
    const t = Math.min(1, layer.tone[i] / top);
    layer.tone[i] = t < 0.06 ? 0 : t;
    if (hot && t > 0) layer.hot[i] = 1;
  }
}

async function imageLayer(s: Extract<Source, { kind: "image" }>, grid: Grid) {
  const img = await loadImage(s.src);
  const box = bbox(img);
  const fit = Math.min(grid.cols / box.w, grid.rows / box.h) * (s.scale ?? 0.86);
  const w = box.w * fit, h = box.h * fit;
  const { cur, cx, cy, cw, ch } = shrink(img, box.x, box.y, box.w, box.h, w, h);
  const c = canvas(grid.cols, grid.rows);
  ctx2d(c).drawImage(cur, cx, cy, cw, ch, (grid.cols - w) / 2, (grid.rows - h) / 2 + (s.y ?? 0) * grid.rows, w, h);
  const layer = empty(grid);
  readAlpha(c, grid, layer, !!s.hot);
  return layer;
}

// the real price line as dots, a fading fill under it, and the hedge line in red
function chartLayer(s: Extract<Source, { kind: "chart" }>, grid: Grid) {
  const { cols, rows } = grid;
  const layer = empty(grid);
  const v = s.closes;
  if (v.length < 2) return layer;
  const lo = Math.min(...v, s.line || Infinity), hi = Math.max(...v);
  const top = rows * 0.2, bot = rows * 0.8;
  const yOf = (p: number) => top + (1 - (p - lo) / (hi - lo || 1)) * (bot - top);
  const x0 = Math.round(cols * 0.03), x1 = Math.round(cols * 0.97);
  let prev: number | null = null;
  for (let c = x0; c <= x1; c++) {
    const u = ((c - x0) / (x1 - x0)) * (v.length - 1);
    const i = Math.floor(u), f = u - i;
    const y = yOf(v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * f);
    const a = Math.min(prev ?? y, y) - 0.55, b = Math.max(prev ?? y, y) + 0.55;
    for (let r = 0; r < rows; r++) {
      const k = r * cols + c;
      if (r >= a && r <= b) layer.tone[k] = 1;
      else if (r > b && (r + c) % 2 === 0) layer.tone[k] = Math.max(0, 0.16 * (1 - (r - b) / (rows * 0.4)));
    }
    prev = y;
  }
  if (s.line) {
    const r = Math.round(yOf(s.line));
    for (let c = x0; c <= x1; c += 2) {
      const k = r * cols + c;
      layer.tone[k] = 0.8;
      layer.hot[k] = 1;
    }
  }
  return layer;
}

function textLayer(s: Extract<Source, { kind: "text" }>, grid: Grid, family: string) {
  const S = 6;
  const big = canvas(grid.cols * S, grid.rows * S);
  const x = ctx2d(big);
  let size = big.height * 0.9;
  x.font = `600 ${size}px ${family}`;
  size = Math.min(size, (size * big.width * 0.98) / x.measureText(s.text).width);
  x.font = `600 ${size}px ${family}`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#fff";
  x.fillText(s.text, big.width / 2, big.height / 2 - size * 0.06);
  const { cur, cx, cy, cw, ch } = shrink(big, 0, 0, big.width, big.height, grid.cols, grid.rows);
  const c = canvas(grid.cols, grid.rows);
  ctx2d(c).drawImage(cur, cx, cy, cw, ch, 0, 0, grid.cols, grid.rows);
  const layer = empty(grid);
  readAlpha(c, grid, layer, false);
  return layer;
}

export async function build(sources: Source[], grid: Grid, family: string) {
  return Promise.all(
    sources.map((s) => {
      if (s.kind === "image") return imageLayer(s, grid);
      if (s.kind === "chart") return chartLayer(s, grid);
      if (s.kind === "text") return textLayer(s, grid, family);
      return empty(grid);
    }),
  );
}

// cheap stable noise per cell and tick
export function hash(a: number, b: number) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
