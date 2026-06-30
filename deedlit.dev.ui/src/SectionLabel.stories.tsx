import type { Meta, StoryObj } from "@storybook/react-vite";

import SectionLabel from "./SectionLabel";

const meta = {
  title: "Components/SectionLabel",
  component: SectionLabel,
  tags: ["autodocs"],
  args: {
    children: "Positive Prompt",
  },
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InContext: Story = {
  render: () => (
    <div className="w-80 space-y-3">
      <div>
        <SectionLabel>Details</SectionLabel>
        <p className="mt-1 text-ui-sm text-[color:var(--ui-ink-secondary)]">SD 1.5 · 512×768 · 28 steps</p>
      </div>
      <div>
        <SectionLabel>Negative Prompt</SectionLabel>
        <p className="mt-1 text-ui-sm text-[color:var(--ui-ink-secondary)]">blurry, lowres, watermark</p>
      </div>
    </div>
  ),
};
