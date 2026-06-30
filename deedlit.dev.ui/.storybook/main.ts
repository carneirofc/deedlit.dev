import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import("vite");
    // Tailwind v4 reads `@import "tailwindcss"` + `@source` globs from
    // `.storybook/preview.css`, so the same utilities the apps generate are
    // available to the rendered stories.
    return mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
    });
  },
};

export default config;
