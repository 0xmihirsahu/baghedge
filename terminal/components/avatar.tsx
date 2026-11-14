"use client";

import { notionists } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { useEffect, useRef } from "react";
import { CORAL, INK } from "./app/format";

// a person per wallet, in our halftone: dicebear's notionists face (art cc0, code mit), seeded by the address,
// sampled into a dot grid and drawn as ink dots on a coral disc. everything happens in the browser, no requests
export function WalletAvatar({ address, size = 36, className = "" }: { address: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gone = false;
    const svg = createAvatar(notionists, { seed: address, scale: 110, translateY: 4 }).toString();
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (gone || !c) return;
      // sample finely, then keep the darkest value per cell so thin pen lines survive
      const cells = Math.max(13, Math.round(size / 2.6));
      const fine = cells * 4;
      const off = document.createElement("canvas");
      off.width = off.height = fine;
      const o = off.getContext("2d", { willReadFrequently: true })!;
      o.drawImage(img, 0, 0, fine, fine);
      const px = o.getImageData(0, 0, fine, fine).data;

      const dpr = window.devicePixelRatio || 1;
      c.width = c.height = Math.round(size * dpr);
      const g = c.getContext("2d")!;
      g.scale(dpr, dpr);
      g.clearRect(0, 0, size, size);
      g.fillStyle = CORAL;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      g.fill();

      const cell = size / cells;
      g.fillStyle = INK;
      for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
          let ink = 0;
          for (let sy = 0; sy < 4; sy++)
            for (let sx = 0; sx < 4; sx++) {
              const i = ((y * 4 + sy) * fine + (x * 4 + sx)) * 4;
              const a = px[i + 3] / 255;
              const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
              ink = Math.max(ink, (1 - lum) * a);
            }
          if (ink < 0.18) continue;
          const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
          // stay inside the disc
          if (Math.hypot(cx - size / 2, cy - size / 2) > size / 2 - cell * 0.6) continue;
          g.beginPath();
          g.arc(cx, cy, cell * 0.46 * Math.min(1, 0.45 + ink), 0, Math.PI * 2);
          g.fill();
        }
    };
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return () => {
      gone = true;
    };
  }, [address, size]);

  return <canvas ref={ref} aria-hidden className={`shrink-0 rounded-full ${className}`} style={{ width: size, height: size, background: CORAL }} />;
}
