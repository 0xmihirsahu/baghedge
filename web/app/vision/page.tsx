import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { VisionPage } from "@/components/vision";

export const metadata: Metadata = {
  title: "Vision | baghedge",
  description: "A line under every coin people keep. Ten coins, the last 30 days on Hyperliquid, each with a line 7% under where it started.",
};

export default function Page() {
  return (
    <>
      <main>
        <VisionPage />
      </main>
      <Footer />
    </>
  );
}
