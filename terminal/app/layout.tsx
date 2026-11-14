import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import "./brand.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });

// favicon, icon, apple icon and share image come from the files in app/, the same set as the landing
export const metadata: Metadata = {
  metadataBase: new URL("https://app.baghedge.xyz"),
  title: { default: "baghedge", template: "%s · baghedge" },
  description: "Trade perps. Hedge your bag.",
  applicationName: "baghedge",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "baghedge", statusBarStyle: "black-translucent" },
  openGraph: { type: "website", siteName: "baghedge", title: "baghedge", description: "Trade perps. Hedge your bag." },
  twitter: { card: "summary_large_image", site: "@baghedge", title: "baghedge", description: "Trade perps. Hedge your bag." },
};

export const viewport: Viewport = { themeColor: "#0b0908", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`} style={{ ["--bh-font" as string]: "var(--font-figtree), ui-sans-serif, system-ui, sans-serif" }}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
