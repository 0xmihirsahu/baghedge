import { Film } from "@/components/film";
import { Wordmark } from "@/components/wordmark";

export default function Home() {
  return (
    <>
      <main>
        <Film />
      </main>
      <footer className="px-2 pb-6 pt-24 sm:px-3 sm:pt-40">
        <Wordmark />
        <div className="mt-6 flex flex-col gap-2 px-4 text-[13px] text-white/40 sm:flex-row sm:justify-between sm:px-9">
          <p>© 2026 baghedge</p>
          <p>Perpetual futures can lose money. Nothing here is financial advice.</p>
        </div>
      </footer>
    </>
  );
}
