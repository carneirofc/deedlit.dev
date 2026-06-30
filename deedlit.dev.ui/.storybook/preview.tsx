import { useEffect } from "react";
import type { Decorator, Preview } from "@storybook/react-vite";

import "./preview.css";

type ThemeName = "light" | "dark";

/** Apply the selected theme the same way the app does: a `data-theme` attribute
 *  on the document element, which flips the CSS-variable design tokens. */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme as ThemeName) ?? "light";

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    return () => {
      root.removeAttribute("data-theme");
    };
  }, [theme]);

  return <Story />;
};

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' surfaces a11y violations in the panel without failing the build.
      test: "todo",
    },
  },
  initialGlobals: {
    theme: "light",
  },
  globalTypes: {
    theme: {
      description: "Design-system theme",
      toolbar: {
        title: "Theme",
        icon: "contrast",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withTheme],
};

export default preview;
