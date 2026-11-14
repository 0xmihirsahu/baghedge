import type { NextConfig } from "next";

// /api routes here win; anything else under /api goes to the baghedge server (BACKEND_URL, e.g. http://127.0.0.1:3001)
const backend = process.env.BACKEND_URL;

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
    return backend ? { beforeFiles: [], afterFiles: [], fallback: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }] } : [];
  },
};

export default nextConfig;
