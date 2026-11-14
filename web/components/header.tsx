import { Mascot } from "@/components/mascot";
import { APP_URL } from "@/lib/site";

// the top row inside the first card of every page
export function Header() {
  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-[72px] items-center justify-between px-6 sm:h-[96px] sm:px-12">
      <a href="/" className="flex items-center gap-2">
        <Mascot className="size-7" />
        <span className="text-[19px] font-semibold tracking-[-0.03em]">baghedge</span>
      </a>
      <nav className="flex items-center gap-6">
        <a href="/vision" className="text-[15px] text-white/80 transition-colors hover:text-white">
          Vision
        </a>
        <a
          href={APP_URL}
          className="rounded-[10px] bg-brand px-4 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]"
        >
          Launch app
        </a>
      </nav>
    </header>
  );
}
