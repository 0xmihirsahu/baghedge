import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import { MarketsProvider } from "@/lib/markets";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "baghedge | Protect your bags without selling a coin",
  description:
    "Draw a line under any coin you hold. If the price falls through it, a short on Hyperliquid covers what's in your wallet. Your coins never move.",
  applicationName: "baghedge",
  openGraph: {
    type: "website",
    siteName: "baghedge",
    title: "baghedge",
    description: "Protect your bags without selling a coin. A short on Hyperliquid, only below the line you draw.",
  },
  twitter: {
    card: "summary_large_image",
    title: "baghedge",
    description: "Protect your bags without selling a coin. A short on Hyperliquid, only below the line you draw.",
  },
};

export const viewport: Viewport = { themeColor: "#1c1b1a" };

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
