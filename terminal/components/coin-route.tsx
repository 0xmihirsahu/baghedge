"use client";

import { use } from "react";
import { CoinPage } from "./coin";

// /markets/[coin]: the same coin page, for any market. names are case-sensitive on hyperliquid (kPEPE, HYPE)
export function CoinRoute({ params }: { params: Promise<{ coin: string }> }) {
  const { coin } = use(params);
  return <CoinPage key={coin} coin={decodeURIComponent(coin)} />;
}
