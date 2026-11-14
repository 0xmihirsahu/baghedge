import type { Metadata } from "next";
import { PortfolioPage } from "@/components/portfolio";

// the terminal waits for the backend's network before it renders (store.tsx), so there is no instant shell to validate
export const instant = false;

export const metadata: Metadata = { title: "Portfolio" };

export default function Page() {
  return <PortfolioPage />;
}
