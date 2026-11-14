import type { NextConfig } from "next";

// the baghedge backend (docs/INTEGRATION.md): its /api paths are proxied under our origin so the sign-in cookie
// (HttpOnly, SameSite=Lax) works. our own /api/balance keeps answering here
const BACKEND = process.env.BAGHEDGE_API_URL;
const PATHS = ["health", "markets", "accounts", "wallet", "hedges", "session", "events", "transfers", "hl"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (!BACKEND) return [];
    return [
      ...PATHS.map((p) => ({ source: `/api/${p}/:path*`, destination: `${BACKEND}/api/${p}/:path*` })),
      ...PATHS.map((p) => ({ source: `/api/${p}`, destination: `${BACKEND}/api/${p}` })),
    ];
  },
};

export default nextConfig;
