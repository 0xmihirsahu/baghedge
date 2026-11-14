import type { MetadataRoute } from "next";

const APP = "https://app.baghedge.xyz";

// the pages a reader can open without signing in
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/markets", "/portfolio", "/activity", "/markets/BTC", "/markets/ETH", "/markets/HYPE", "/markets/NEAR", "/llms.txt"].map((p) => ({
    url: `${APP}${p}`,
    changeFrequency: p === "" || p.startsWith("/markets") ? "always" : "weekly",
    priority: p === "" ? 1 : 0.6,
  }));
}
