import type { Metadata } from "next";
import { MarketsPage } from "@/components/markets";

// the terminal waits for the backend's network before it renders (store.tsx), so there is no instant shell to validate
export const instant = false;

export const metadata: Metadata = { title: "Markets" };

export default function Page() {
  return <MarketsPage />;
}
