import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found" };

// standalone, outside the shell. the bag loses its dots looking for the page; reduced motion gets the still
export default function NotFound() {
  return (
    <main className="relative flex h-svh flex-col items-center justify-center overflow-hidden bg-[#0b0908] px-6 text-center">
      <Link href="/" className="absolute left-5 top-5 flex items-center gap-2 sm:left-7 sm:top-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mascot.webp" alt="" className="size-6" />
        <span className="text-[18px] font-semibold tracking-[-0.03em]">baghedge</span>
      </Link>
      <div className="aspect-square w-[min(320px,42svh)] sm:w-[min(420px,48svh)]">
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
      <h1 className="mt-1 sm:mt-2 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">Nothing here</h1>
      <p className="mt-3 max-w-[320px] text-[15px] leading-[1.5] text-white/60">No market or page lives at this address.</p>
      <div className="mt-6 flex items-center gap-5">
        <Link href="/markets" className="rounded-[12px] bg-brand px-5 py-3 text-[15px] font-medium text-white transition-transform active:scale-[0.98]">
          Back to markets
        </Link>
        <Link href="/" className="text-[15px] font-medium text-white/60 transition-colors hover:text-white">
          Hedge
        </Link>
      </div>
    </main>
  );
}
