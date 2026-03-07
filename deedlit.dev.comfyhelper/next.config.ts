import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
  images: {
    qualities: [60, 75],
    localPatterns: [
      {
        pathname: "/api/image",
      },
    ],
  },
};

export default nextConfig;

