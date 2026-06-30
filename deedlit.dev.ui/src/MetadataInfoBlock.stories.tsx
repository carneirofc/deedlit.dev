import type { Meta, StoryObj } from "@storybook/react-vite";

import MetadataInfoBlock from "./MetadataInfoBlock";

const meta = {
  title: "Components/MetadataInfoBlock",
  component: MetadataInfoBlock,
  tags: ["autodocs"],
  args: {
    children: "Parsed from embedded PNG tEXt chunk · parameters",
  },
} satisfies Meta<typeof MetadataInfoBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MultiLine: Story = {
  render: (args) => (
    <MetadataInfoBlock {...args}>
      <p>Source: embedded PNG metadata</p>
      <p className="mt-1 text-[color:var(--ui-ink-subtle)]">Field: parameters · 1.4 KB</p>
    </MetadataInfoBlock>
  ),
};
