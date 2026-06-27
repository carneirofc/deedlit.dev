import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@deedlit.dev/ui"],
  turbopack: {
    resolveAlias: {
      "@deedlit.dev/ui": "../deedlit.dev.ui/src/index.ts",
      "@deedlit.dev/ui/styles.css": "../deedlit.dev.ui/styles/styles.css"
    }
  },
  webpack(config) {
    config.resolve.alias["@deedlit.dev/ui"] = require("path").resolve(__dirname, "../deedlit.dev.ui/src/index.ts");
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

