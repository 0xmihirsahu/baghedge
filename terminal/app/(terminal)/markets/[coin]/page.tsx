import type { Metadata } from "next";
import { Suspense } from "react";
import { CoinRoute } from "@/components/coin-route";

// a fixed title: reading the coin from the url here would block the route's metadata under cache components
export const metadata: Metadata = { title: "Market" };

export default function Page({ params }: PageProps<"/markets/[coin]">) {
  return (
    <Suspense>
      <CoinRoute params={params} />
    </Suspense>
  );
}
