"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "./app/hl";
import { CORAL, DOWN, INK, UP, compact, pct } from "./app/format";

// a trader's chart: candles with volume, price and time axes, a crosshair with an OHLCV readout.
// for the hedge, entry (coral) and recovery (white) sit on it as price lines; while drafting they drag.
// tradingview lightweight charts, apache-2.0 (the attribution logo stays on, as its licence asks)
type Rule = { entry: number; recovery: number; editing: boolean; armed: boolean; onEntry: (v: number) => void; onRecovery: (v: number) => void };

const sec = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
const fade = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

export function Chart({ candles, decimals, rule }: { candles: Candle[]; decimals: number; rule?: Rule }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const loaded = useRef<{ first: number; length: number } | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const ruleRef = useRef(rule);
  const lines = useRef<{ entry: IPriceLine; recovery: IPriceLine } | null>(null);

  useEffect(() => {
    const el = box.current!;
    const font = getComputedStyle(document.body).fontFamily;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: INK }, textColor: "rgba(255,255,255,0.45)", fontFamily: font, fontSize: 12 },
      grid: { vertLines: { color: "rgba(255,255,255,0.035)" }, horzLines: { color: "rgba(255,255,255,0.035)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#2e2c2a" },
        horzLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#2e2c2a" },
      },
    });
    const p = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineStyle: LineStyle.Dotted,
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } | null; margins?: { above: number; below: number } } | null) => {
        const r = base(), rule = ruleRef.current;
        if (!r?.priceRange || !rule?.entry) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, rule.entry, rule.recovery), maxValue: Math.max(r.priceRange.maxValue, rule.entry, rule.recovery) } };
      },
    });
    const v = c.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    c.subscribeCrosshairMove((e) => {
      const d = e.seriesData.get(p) as { open: number; high: number; low: number; close: number; time: number } | undefined;
      const vol = e.seriesData.get(v) as { value: number } | undefined;
      setHover(d ? { t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: vol?.value ?? 0 } : null);
    });
    chart.current = c;
    price.current = p;
    volume.current = v;
    return () => {
      c.remove();
      chart.current = null;
      loaded.current = null;
      lines.current = null;
    };
  }, []);

  useEffect(() => {
    price.current?.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals } });
  }, [decimals]);

  // a new range resets the data; a moving last candle only updates it, so a panned chart stays put
  useEffect(() => {
    const p = price.current, v = volume.current;
    if (!p || !v || !candles.length) return;
    const bar = (k: Candle) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c });
    const vol = (k: Candle) => ({ time: sec(k.t), value: k.v * k.c, color: fade(k.c >= k.o ? UP : DOWN, 0.35) });
    const prev = loaded.current;
    if (prev && prev.first === candles[0].t && Math.abs(prev.length - candles.length) <= 1) {
      const last = candles[candles.length - 1];
      p.update(bar(last));
      v.update(vol(last));
    } else if (prev && prev.length === candles.length && candles.length > 1) {
      // the window slid by one candle
      const last = candles[candles.length - 1];
      p.update(bar(last));
      v.update(vol(last));
    } else {
      p.setData(candles.map(bar));
      v.setData(candles.map(vol));
      chart.current?.timeScale().fitContent();
    }
    loaded.current = { first: candles[0].t, length: candles.length };
  }, [candles]);

  // the rule as price lines, kept in place as the scale moves
  useEffect(() => {
    const p = price.current;
    if (!p) return;
    if (!rule || !rule.entry) {
      if (lines.current) {
        p.removePriceLine(lines.current.entry);
        p.removePriceLine(lines.current.recovery);
        lines.current = null;
      }
      return;
    }
    const style = rule.armed ? LineStyle.Dashed : LineStyle.LargeDashed;
    const entry = { price: rule.entry, color: rule.armed ? CORAL : fade(CORAL, 0.7), lineWidth: 2 as const, lineStyle: style, axisLabelVisible: true, title: "Entry" };
    const recovery = { price: rule.recovery, color: rule.armed ? "#ffffff" : "rgba(255,255,255,0.7)", lineWidth: 2 as const, lineStyle: style, axisLabelVisible: true, title: "Recovery" };
    if (!lines.current) lines.current = { entry: p.createPriceLine(entry), recovery: p.createPriceLine(recovery) };
    else {
      lines.current.entry.applyOptions(entry);
      lines.current.recovery.applyOptions(recovery);
    }
  }, [rule]);

  // drag handles: where each line sits right now, refreshed each frame while drafting
  const [ys, setYs] = useState<{ entry: number | null; recovery: number | null; scale: number }>({ entry: null, recovery: null, scale: 64 });
  const editing = !!rule?.editing && !!rule.entry;
  useEffect(() => {
    ruleRef.current = rule;
  });
  useEffect(() => {
    if (!editing) return;
    let raf = 0;
    const tick = () => {
      const p = price.current, r = ruleRef.current;
      if (p && r) {
        const e = p.priceToCoordinate(r.entry), v = p.priceToCoordinate(r.recovery);
        const scale = chart.current?.priceScale("right").width() ?? 64;
        setYs((o) => (o.entry === e && o.recovery === v && o.scale === scale ? o : { entry: e, recovery: v, scale }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const shown = hover ?? candles[candles.length - 1];

  return (
    <div className="absolute inset-0">
      <div ref={box} className="absolute inset-0" />
      {shown && (
        <div className="pointer-events-none absolute left-4 top-2 z-10 flex flex-wrap gap-x-3 text-[12px] tabular-nums text-white/45">
          {(["o", "h", "l", "c"] as const).map((k) => (
            <span key={k}>
              {k.toUpperCase()} <span style={{ color: shown.c >= shown.o ? UP : DOWN }}>{shown[k].toFixed(decimals)}</span>
            </span>
          ))}
          <span style={{ color: shown.c >= shown.o ? UP : DOWN }}>{pct(shown.c / shown.o - 1)}</span>
          <span>V {compact(shown.v * shown.c).slice(1)}</span>
        </div>
      )}
      {editing &&
        (["entry", "recovery"] as const).map((k) =>
          ys[k] === null ? null : (
            <div
              key={k}
              className="absolute left-0 z-10 flex cursor-ns-resize touch-none items-center"
              style={{ top: ys[k]! - 12, height: 24, right: ys.scale }}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const y = e.clientY - box.current!.getBoundingClientRect().top;
                const v = price.current?.coordinateToPrice(y);
                if (v == null) return;
                const r = ruleRef.current!;
                (k === "entry" ? r.onEntry : r.onRecovery)(Math.round(v * 10 ** decimals) / 10 ** decimals);
              }}
              aria-label={`Drag the ${k} line`}
            >
              <span className="ml-3 size-3 rounded-full" style={{ background: k === "entry" ? CORAL : "#ffffff" }} />
            </div>
          ),
        )}
    </div>
  );
}
