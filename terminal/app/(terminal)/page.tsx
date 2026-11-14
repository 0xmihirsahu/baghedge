import type { Metadata } from "next";
import { CoinPage } from "@/components/coin";

export const metadata: Metadata = { title: "Hedge" };

export default function Page() {
  return <CoinPage coin="SOL" />;
}
