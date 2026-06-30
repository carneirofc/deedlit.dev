import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * The type system ships as ready-made utility classes (defined in
 * `styles/styles.css`) rather than raw font-size tokens, so apps stay
 * consistent without re-deriving the fluid `clamp()` scale.
 *
 * - `text-ui-*` — the fluid size ramp (2xs → display).
 * - `ui-text-label*` — uppercase, letter-spaced eyebrow labels.
 * - `ui-text-body*` — comfortable reading body copy.
 */
const meta: Meta = {
  title: "Foundations/Typography",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

function Row({ cls, token, children }: { cls: string; token: string; children: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-ui-faint py-3">
      <span className={`${cls} text-[color:var(--ui-ink-strong)]`}>{children}</span>
      <div className="flex items-baseline gap-3">
        <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">.{cls}</code>
        <code className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">{token}</code>
      </div>
    </div>
  );
}

export const Scale: Story = {
  name: "Size scale",
  render: () => (
    <div className="max-w-3xl p-6">
      <Row cls="text-ui-display" token="--ui-font-display">Display heading</Row>
      <Row cls="text-ui-xl" token="--ui-font-xl">Extra large title</Row>
      <Row cls="text-ui-lg" token="--ui-font-lg">Large title</Row>
      <Row cls="text-ui-md" token="--ui-font-md">Medium / base body</Row>
      <Row cls="text-ui-sm" token="--ui-font-sm">Small body</Row>
      <Row cls="text-ui-xs" token="--ui-font-xs">Extra small / meta</Row>
      <Row cls="text-ui-2xs" token="--ui-font-2xs">2xs label text</Row>
    </div>
  ),
};

export const Labels: Story = {
  render: () => (
    <div className="max-w-3xl p-6">
      <Row cls="ui-text-label" token="weight 600 · 0.08em">Section label</Row>
      <Row cls="ui-text-label-sm" token="weight 600 · 0.08em">Section label sm</Row>
      <Row cls="ui-text-label-compact" token="weight 500 · 0.06em">Compact label</Row>
    </div>
  ),
};

export const Body: Story = {
  render: () => (
    <div className="max-w-2xl space-y-4 p-6">
      <p className="ui-text-body text-[color:var(--ui-ink)]">
        <code className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">.ui-text-body</code> — the default
        reading style for descriptions and help text. It pairs the small size token with relaxed line height
        so multi-line copy stays legible inside dense panels.
      </p>
      <p className="ui-text-body-strong text-[color:var(--ui-ink-strong)]">
        <code className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">.ui-text-body-strong</code> — the same
        size, bumped to semibold for emphasis lines and inline callouts.
      </p>
    </div>
  ),
};
