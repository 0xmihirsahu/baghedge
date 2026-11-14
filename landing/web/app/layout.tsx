import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import { MarketsProvider } from "@/lib/markets";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "baghedge | Trade perps. Hedge your bag.",
  description: "A Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet.",
  applicationName: "baghedge",
  openGraph: {
    type: "website",
    siteName: "baghedge",
    title: "baghedge",
    description: "Trade perps. Hedge your bag. A Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet.",
  },
  twitter: {
    card: "summary_large_image",
    title: "baghedge",
    description: "Trade perps. Hedge your bag. A Hyperliquid trading terminal that can hedge the SOL you already hold in your wallet.",
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
