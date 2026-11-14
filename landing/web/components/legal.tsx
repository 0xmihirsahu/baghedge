import type { ReactNode } from "react";
import { Header } from "@/components/header";

// one readable column inside the black card, for terms, privacy and the disclaimer
export function Legal({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="p-2 sm:p-3">
      <div className="bg-coal relative rounded-[20px] px-6 pb-20 pt-[128px] sm:rounded-[24px] sm:px-12 sm:pb-28 sm:pt-[168px]">
        <Header />
        <article className="mx-auto max-w-[680px]">
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] sm:text-[44px]">{title}</h1>
          <p className="mt-3 text-[14px] text-white/50">Last updated 14 November 2026</p>
          <p className="mt-10 text-[19px] leading-[1.55] text-white/90">{intro}</p>
          <div className="legal mt-4">{children}</div>
        </article>
      </div>
    </section>
  );
}
