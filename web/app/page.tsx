import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Story } from "@/components/story";

export default function Home() {
  return (
    <>
      <main>
        <Hero />
        <Story />
      </main>
      <Footer />
    </>
  );
}
