import type { Metadata } from "next";
import { BrandPage } from "@/components/brand";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Brand kit | baghedge",
  description: "The baghedge logo, mark, colours, type and halftone art.",
};

export default function Page() {
  return (
    <>
      <main>
        <BrandPage />
      </main>
      <Footer />
    </>
  );
}
