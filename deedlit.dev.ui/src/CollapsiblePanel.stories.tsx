import type { Meta, StoryObj } from "@storybook/react-vite";

import CollapsiblePanel from "./CollapsiblePanel";

const meta = {
  title: "Components/CollapsiblePanel",
  component: CollapsiblePanel,
  tags: ["autodocs"],
  args: {
    label: "Raw metadata",
    defaultOpen: false,
  },
} satisfies Meta<typeof CollapsiblePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const Body = () => (
  <div className="px-4 py-3 text-ui-sm text-[color:var(--ui-ink-secondary)]">
    Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 3268129004, Size: 512x768
  </div>
);

export const Closed: Story = {
  render: (args) => (
    <div className="w-96 rounded-xl border border-ui bg-[color:var(--ui-bg-card)]">
      <CollapsiblePanel {...args}>
        <Body />
      </CollapsiblePanel>
    </div>
  ),
};

export const OpenByDefault: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="w-96 rounded-xl border border-ui bg-[color:var(--ui-bg-card)]">
      <CollapsiblePanel {...args}>
        <Body />
      </CollapsiblePanel>
    </div>
  ),
};
