import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@carneirofc/ui"],
  turbopack: {
    resolveAlias: {
      "@carneirofc/ui": "../deedlit.dev.ui/src/index.ts",
      "@carneirofc/ui/styles.css": "../deedlit.dev.ui/styles/styles.css"
    }
  },
  webpack(config) {
    config.resolve.alias["@carneirofc/ui"] = require("path").resolve(__dirname, "../deedlit.dev.ui/src/index.ts");
    return config;
  },
  experimental: {
    externalDir: true
  },
  output: 'standalone',
  // Image optimization (resize + WebP/AVIF) is left to Next's built-in
  // optimizer. The /image?id=… route is a same-origin local path, so the
  // default loader serves resized variants via /_next/image and caches them.
  // Next 16 requires query-string local sources to be whitelisted; `search`
  // is omitted so any ?id=… is allowed.
  images: {
    localPatterns: [{ pathname: "/image" }],
  },
};

export default nextConfig;

