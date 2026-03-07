import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "deedlit.dev",
    short_name: "deedlit",
    description: "SDXL and Flux image archive with metadata-first browsing.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c13",
    theme_color: "#0a0c13",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
