import type { Metadata } from "next";
import { Suspense } from "react";
import { CoinRoute } from "@/components/coin-route";

export async function generateMetadata({ params }: PageProps<"/markets/[coin]">): Promise<Metadata> {
  const { coin } = await params;
  return { title: decodeURIComponent(coin) };
}

export default function Page({ params }: PageProps<"/markets/[coin]">) {
  return (
    <Suspense>
      <CoinRoute params={params} />
    </Suspense>
  );
}
