import type { Metadata } from "next";
import { CoinPage } from "@/components/coin";

// the terminal waits for the backend's network before it renders (store.tsx), so there is no instant shell to validate
export const instant = false;

export const metadata: Metadata = { title: "Hedge" };

export default function Page() {
  return <CoinPage coin="SOL" />;
}
