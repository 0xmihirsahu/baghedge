import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { APP_URL, X_URL } from "@/lib/site";

const LINKS: { label: string; href: string; out?: boolean }[] = [
  { label: "App", href: APP_URL },
  { label: "Vision", href: "/vision" },
  { label: "About", href: "/about" },
  { label: "Brand kit", href: "/brand" },
  { label: "X", href: X_URL, out: true },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Disclaimer", href: "/disclaimer" },
];

// quiet on purpose: one row of links, then the name in dots
export function Footer() {
  return (
    <footer className="px-2 pb-3 pt-24 sm:px-3 sm:pt-32">
      <div className="flex flex-col gap-5 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-9">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/60">
          {LINKS.map((l) =>
            l.out || l.href.startsWith("http") ? (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className="transition-colors hover:text-white">
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <p className="text-[13px] text-white/40">© 2026 baghedge. A hedge, not insurance.</p>
      </div>
      <div className="mt-8 sm:mt-10">
        <Wordmark />
      </div>
    </footer>
  );
}
