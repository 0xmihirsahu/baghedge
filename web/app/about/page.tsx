import type { Metadata } from "next";
import { AboutPage } from "@/components/about";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "About | baghedge",
  description: "baghedge started with one bad night. Built by Vivek and Mihir, in India, on NEAR and Hyperliquid.",
};

export default function Page() {
  return (
    <>
      <main>
        <AboutPage />
      </main>
      <Footer />
    </>
  );
}
