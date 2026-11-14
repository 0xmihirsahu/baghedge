import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import { MarketsProvider } from "@/lib/markets";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "baghedge | Protect your bags without selling a coin",
  description:
    "Draw a line under any coin you hold. If the price falls through it, a short on Hyperliquid covers what's in your wallet. Your coins never move.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} antialiased`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <SmoothScroll>
          <MarketsProvider>{children}</MarketsProvider>
        </SmoothScroll>
      </body>
    </html>
  );
}
