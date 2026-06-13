import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@deedlit.dev/ui"],
  // Native / server-only packages must not be bundled by the Next compiler.
  // The OpenTelemetry instrumentations use Node module hooks (require/import-in-
  // the-middle) and must stay external so they can patch pg/@aws-sdk at runtime.
  serverExternalPackages: [
    "sharp",
    "pg",
    "neo4j-driver",
    "@qdrant/js-client-rest",
    "@aws-sdk/client-s3",
    "@opentelemetry/instrumentation-pg",
    "@opentelemetry/instrumentation-aws-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "@deedlit.dev/ui": "../deedlit.dev.ui/src/index.ts",
      "@deedlit.dev/ui/styles.css": "../deedlit.dev.ui/styles/styles.css"
    }
  },
  webpack(config) {
    config.resolve.alias["@deedlit.dev/ui"] = path.resolve(__dirname, "../deedlit.dev.ui/src/index.ts");
    return config;
  },
  images: {
    qualities: [60, 75],
    localPatterns: [
      {
        pathname: "/api/library/images/**",
      },
    ],
  },
  // Accept an optional image extension on the proxy routes (e.g. `/file.webp`)
  // so the Qdrant dashboard renders the payload URLs as image previews. The
  // extension is cosmetic — the handler serves bytes/content-type from the DB —
  // so we strip it here. Plain `/file` (no `.`) still routes directly.
  async rewrites() {
    return [
      { source: "/api/library/images/:imageId/file.:ext", destination: "/api/library/images/:imageId/file" },
      { source: "/api/library/images/:imageId/thumbnail.:ext", destination: "/api/library/images/:imageId/thumbnail" },
    ];
  },
};

export default nextConfig;
