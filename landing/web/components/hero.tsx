"use client";

import { Copy } from "@/components/copy";
import { Field } from "@/components/field";
import { Header } from "@/components/header";
import type { Source } from "@/lib/field";
import { APP_URL } from "@/lib/site";

const BAG: Source[] = [{ kind: "image", src: "/art/bag-hero-a.webp", scale: 0.9 }];
const PITCH: [number, number] = [5, 6];

// the bag decodes in, centred, with the line under it
export function Hero() {
  return (
    <section id="top" className="h-svh p-2 sm:p-3">
      <div className="relative h-full overflow-hidden rounded-[20px] bg-coal sm:rounded-[24px]">
        <Header />

        <div className="absolute inset-x-3 top-[11%] h-[46%] sm:left-1/2 sm:top-[10%] sm:h-[54%] sm:w-[52%] sm:-translate-x-1/2">
          <Field sources={BAG} pitch={PITCH} intro hover />
        </div>

        <div className="absolute inset-x-6 bottom-[6%] sm:bottom-[7%]">
          <Copy state="in" title="Trade perps. Hedge your bag." hero>
            <p>A Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet.</p>
            <a
              href={APP_URL}
              className="mt-6 inline-flex rounded-[10px] bg-brand px-4 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]"
            >
              Launch app
            </a>
          </Copy>
        </div>
      </div>
    </section>
  );
}
