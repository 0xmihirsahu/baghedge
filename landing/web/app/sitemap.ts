import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PAGES = ["", "/vision", "/about", "/brand", "/terms", "/privacy", "/disclaimer", "/llms.txt"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE_URL}${p}`, lastModified: new Date("2026-11-14"), changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
