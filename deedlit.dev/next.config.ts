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
  images: {
    // Use custom loader for our /image route
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
  },
};

export default nextConfig;

