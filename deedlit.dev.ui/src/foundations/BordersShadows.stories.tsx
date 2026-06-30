import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Border and elevation tokens. The `border-ui-*` utility classes give every
 * component a consistent hairline, the `--panel-border*` tokens drive the neon
 * cyber edges, and the shadow tokens provide the two standard depths.
 */
const meta: Meta = {
  title: "Foundations/Borders & Shadows",
  parameters: { layout: "fullscreen", a11y: { test: "off" } },
};

export default meta;
type Story = StoryObj;

const BORDER_UTILITIES = [
  "border-ui",
  "border-ui-strong",
  "border-ui-soft",
  "border-ui-faint",
  "border-ui-subtle",
  "border-ui-muted",
  "border-ui-faintest",
  "border-ui-modal",
  "border-ui-active",
  "border-ui-focus",
];

const PANEL_BORDERS = ["--panel-border", "--panel-border-strong", "--line-soft"];

const SHADOWS = [
  { cls: "shadow-panel-sm", token: "--shadow-sm" },
  { cls: "shadow-panel-lg", token: "--shadow-lg" },
  { cls: "shadow-ui-card", token: "--ui-shadow-card" },
  { cls: "shadow-ui-strong", token: "--ui-shadow-strong" },
];

export const BorderUtilities: Story = {
  name: "Border utilities",
  render: () => (
    <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-5">
      {BORDER_UTILITIES.map((cls) => (
        <div key={cls} className={`rounded-xl border bg-[color:var(--ui-bg-card)] px-3 py-6 ${cls}`}>
          <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">.{cls}</code>
        </div>
      ))}
    </div>
  ),
};

export const PanelBorders: Story = {
  name: "Panel borders",
  render: () => (
    <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-3">
      {PANEL_BORDERS.map((token) => (
        <div
          key={token}
          className="rounded-2xl bg-[color:var(--ui-bg-card)] px-3 py-8"
          style={{ border: `1px solid var(${token})` }}
        >
          <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">{token}</code>
        </div>
      ))}
    </div>
  ),
};

export const Shadows: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-8 p-10 sm:grid-cols-2 lg:grid-cols-4">
      {SHADOWS.map(({ cls, token }) => (
        <div key={cls} className={`rounded-2xl border border-ui bg-[color:var(--ui-bg-card)] px-3 py-8 ${cls}`}>
          <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">.{cls}</code>
          <p className="mt-1 text-ui-2xs text-[color:var(--ui-ink-subtle)]">{token}</p>
        </div>
      ))}
    </div>
  ),
};
