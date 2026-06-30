import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * The `.cyber-*` class set is the signature "glass + neon" treatment shared
 * across the apps. Most are wrapped by components (`CyberPanel`, `InfoChip`,
 * `TextInput`, `OutlineButton`) but the raw classes are available for one-off
 * layouts that need the same look.
 */
const meta: Meta = {
  title: "Foundations/Cyber Styles",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

export const Panels: Story = {
  render: () => (
    <div className="w-[28rem] space-y-4">
      <section className="cyber-panel rounded-[28px] px-5 py-6">
        <p className="cyber-title text-ui-lg font-semibold">.cyber-panel</p>
        <p className="cyber-muted mt-1 text-ui-sm">
          The hero surface — translucent gradient fill, blurred backdrop and a large soft shadow.
        </p>
        <div className="cyber-subpanel mt-4 rounded-2xl p-4">
          <p className="text-ui-sm font-medium">.cyber-subpanel</p>
          <p className="cyber-muted mt-1 text-ui-xs">A nested, lighter panel for grouping content inside a panel.</p>
        </div>
      </section>
    </div>
  ),
};

export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <span className="cyber-chip rounded-full px-3 py-1 text-ui-xs">.cyber-chip</span>
      <span className="cyber-chip rounded-full px-3 py-1 text-ui-xs">masterpiece</span>
      <span className="cyber-chip rounded-full px-3 py-1 text-ui-xs">cinematic</span>
    </div>
  ),
};

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="cyber-button rounded-xl px-4 py-2 text-ui-sm">
        .cyber-button
      </button>
      <button type="button" className="cyber-button-ghost rounded-xl px-4 py-2 text-ui-sm">
        .cyber-button-ghost
      </button>
    </div>
  ),
};

export const Inputs: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-3">
      <input className="cyber-input rounded-xl px-3 py-2 text-ui-sm outline-none" placeholder=".cyber-input" />
      <textarea
        className="cyber-input resize-y rounded-xl px-3 py-2 text-ui-sm outline-none"
        rows={3}
        placeholder=".cyber-input (textarea)"
      />
    </div>
  ),
};

export const Text: Story = {
  render: () => (
    <div className="cyber-panel w-[24rem] rounded-[28px] px-5 py-6">
      <p className="cyber-title text-ui-xl font-semibold">.cyber-title</p>
      <p className="cyber-muted mt-2 text-ui-sm">.cyber-muted — the de-emphasised body tone used on panels.</p>
    </div>
  ),
};
