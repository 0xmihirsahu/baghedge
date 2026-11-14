import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import "./brand.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });

// favicon, icon, apple icon and share image come from the files in app/, the same set as the landing
export const metadata: Metadata = {
  metadataBase: new URL("https://app.baghedge.xyz"),
  title: { default: "baghedge", template: "%s · baghedge" },
  description: "A Hyperliquid perps terminal that can hedge the SOL you already hold in your own wallet. Fund from any token through NEAR Intents, sign in with email or Google. Live on mainnet.",
  applicationName: "baghedge",
  keywords: ["Hyperliquid", "perps", "hedge", "SOL", "Solana", "NEAR Intents", "OutLayer", "TEE", "DeFi", "NEAR Hackathon", "Privy"],
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "baghedge", statusBarStyle: "black-translucent" },
  openGraph: { type: "website", siteName: "baghedge", title: "baghedge: trade perps, hedge your bag", description: "A Hyperliquid perps terminal that can hedge the SOL you already hold in your own wallet. Fund from any token through NEAR Intents, sign in with email or Google. Live on mainnet." },
  twitter: { card: "summary_large_image", site: "@baghedge", title: "baghedge: trade perps, hedge your bag", description: "A Hyperliquid perps terminal that can hedge the SOL you already hold in your own wallet. Fund from any token through NEAR Intents, sign in with email or Google. Live on mainnet." },
};

export const viewport: Viewport = { themeColor: "#0b0908", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`} style={{ ["--bh-font" as string]: "var(--font-figtree), ui-sans-serif, system-ui, sans-serif" }}>
      <body className="min-h-full">
        <script
          type="application/ld+json"
          // structured data for search and AI readers: what the app is, where the source and evidence are
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "baghedge",
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              url: "https://app.baghedge.xyz",
              description: "A Hyperliquid perps terminal that can hedge the SOL you already hold in your own wallet. Fund from any token through NEAR Intents, sign in with email or Google. Live on mainnet.",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              sameAs: ["https://baghedge.xyz", "https://github.com/0xmihirsahu/baghedge", "https://x.com/baghedge"],
              softwareHelp: "https://github.com/0xmihirsahu/baghedge/blob/main/JUDGES.md",
            }),
          }}
        />
        {children}
      </body>
    </html>
  );
}
