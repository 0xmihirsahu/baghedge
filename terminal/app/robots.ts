import type { MetadataRoute } from "next";

// everyone, AI crawlers included, may read the app. llms.txt has the short version
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Google-Extended"], allow: "/", disallow: "/api/" },
    ],
    sitemap: "https://app.baghedge.xyz/sitemap.xml",
    host: "https://app.baghedge.xyz",
  };
}
