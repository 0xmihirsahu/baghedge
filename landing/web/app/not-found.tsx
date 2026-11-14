import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";

export const metadata: Metadata = { title: "Not found | baghedge" };

// the bag loses its dots looking for the page (films/baghedge-404 in the video harness); reduced motion gets the still
export default function NotFound() {
  return (
    <main className="h-svh p-2 sm:p-3">
      <section className="bg-coal relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[20px] px-6 pt-10 text-center sm:rounded-[24px]">
        <Header />
        <div className="aspect-square w-[min(320px,42svh)] sm:w-[min(440px,50svh)]">
          <video
            src="/media/404.mp4"
            poster="/media/404.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
            className="size-full mix-blend-screen motion-reduce:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/media/404.jpg" alt="" aria-hidden className="hidden size-full mix-blend-screen motion-reduce:block" />
        </div>
        <h1 className="mt-1 sm:mt-2 text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[36px]">Nothing here</h1>
        <p className="mt-3 max-w-[340px] text-[15px] leading-[1.5] text-white/75 sm:text-[16px]">The bag looked everywhere for this page.</p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-[10px] bg-brand px-4 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]"
        >
          Back home
        </Link>
      </section>
    </main>
  );
}
