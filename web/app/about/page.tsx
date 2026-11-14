import type { Metadata } from "next";
import { AboutPage } from "@/components/about";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "About | baghedge",
  description: "baghedge is built by Vivek and Mihir, who both build at Inco.",
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
