import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * The design system layers three families of background tokens, from the
 * furthest-back page wash to the nearest interactive surface:
 *
 * 1. **Page backgrounds** (`--bg-0/1/2`) — the gradient wash painted on `body`.
 * 2. **Surfaces** (`--surface-0/1/2`) — translucent panel fills that sit on the
 *    page wash (used by `cyber-panel`, the sidebar, tooltips, …).
 * 3. **UI backgrounds** (`--ui-bg-*`) — opaque component fills for cards,
 *    inputs, code blocks, tables and status areas.
 *
 * All of them flip with `data-theme="dark"` — use the **Theme** toolbar to
 * compare both token sets.
 */
const meta: Meta = {
  title: "Foundations/Surfaces & Backgrounds",
  parameters: {
    layout: "fullscreen",
    a11y: {
      // Swatch labels are decorative documentation, not interactive contrast targets.
      test: "off",
    },
  },
};

export default meta;
type Story = StoryObj;

type Token = { name: string; note?: string };

function Swatch({ name, note }: Token) {
  return (
    <div className="overflow-hidden rounded-xl border border-ui">
      <div className="h-16 w-full" style={{ background: `var(${name})` }} />
      <div className="bg-[color:var(--ui-bg-card)] px-3 py-2">
        <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">{name}</code>
        {note && <p className="mt-0.5 text-ui-2xs text-[color:var(--ui-ink-subtle)]">{note}</p>}
      </div>
    </div>
  );
}

function Group({ title, description, tokens }: { title: string; description: string; tokens: Token[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-ui-lg font-semibold text-[color:var(--ui-ink-strong)]">{title}</h3>
        <p className="mt-1 max-w-2xl text-ui-sm text-[color:var(--ui-ink-subtle)]">{description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tokens.map((token) => (
          <Swatch key={token.name} {...token} />
        ))}
      </div>
    </section>
  );
}

const PAGE_BACKGROUNDS: Token[] = [
  { name: "--bg-0", note: "Top of the body gradient" },
  { name: "--bg-1", note: "Mid stop" },
  { name: "--bg-2", note: "Bottom stop" },
];

const SURFACES: Token[] = [
  { name: "--surface-0", note: "Panels, tooltips, sidebar" },
  { name: "--surface-1", note: "Raised / hovered surface" },
  { name: "--surface-2", note: "Tinted surface" },
];

const UI_BACKGROUNDS: Token[] = [
  { name: "--ui-bg", note: "Default component fill" },
  { name: "--ui-bg-soft" },
  { name: "--ui-bg-strong" },
  { name: "--ui-bg-alt" },
  { name: "--ui-bg-muted" },
  { name: "--ui-bg-card", note: "Cards / dialogs" },
  { name: "--ui-bg-canvas" },
  { name: "--ui-bg-tint" },
  { name: "--ui-bg-info", note: "Informational area" },
  { name: "--ui-bg-active", note: "Selected / pressed" },
  { name: "--ui-bg-table" },
  { name: "--ui-bg-code", note: "MetadataInfoBlock" },
  { name: "--ui-bg-deep", note: "CodeBlock (inverse)" },
  { name: "--ui-bg-prompt-positive", note: "PromptBlock positive" },
  { name: "--ui-bg-prompt-negative", note: "PromptBlock negative" },
  { name: "--ui-bg-prompt-note", note: "PromptBlock note" },
];

export const PageBackgrounds: Story = {
  render: () => (
    <div className="p-6">
      <Group
        title="Page backgrounds"
        description="The radial-gradient wash on body is composed from these three stops plus the accent glows. They define the furthest-back layer everything else floats over."
        tokens={PAGE_BACKGROUNDS}
      />
    </div>
  ),
};

export const Surfaces: Story = {
  render: () => (
    <div className="p-6">
      <Group
        title="Surfaces"
        description="Translucent panel fills (color-mix with the page wash) used by the cyber panels, sidebar and tooltips. They let the page gradient bleed through for the layered glass look."
        tokens={SURFACES}
      />
    </div>
  ),
};

export const UiBackgrounds: Story = {
  render: () => (
    <div className="p-6">
      <Group
        title="UI backgrounds"
        description="Opaque, component-level fills. Reach for these (or the SurfacePanel tones that wrap them) before writing one-off color classes."
        tokens={UI_BACKGROUNDS}
      />
    </div>
  ),
};

export const Overview: Story = {
  name: "All background layers",
  render: () => (
    <div className="space-y-8 p-6">
      <Group title="1 · Page backgrounds" description="Furthest back — the body gradient wash." tokens={PAGE_BACKGROUNDS} />
      <Group title="2 · Surfaces" description="Translucent panels over the page wash." tokens={SURFACES} />
      <Group title="3 · UI backgrounds" description="Opaque component fills, nearest the user." tokens={UI_BACKGROUNDS} />
    </div>
  ),
};
