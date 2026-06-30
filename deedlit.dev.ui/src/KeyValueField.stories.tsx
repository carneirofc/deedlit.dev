import type { Meta, StoryObj } from "@storybook/react-vite";

import KeyValueField from "./KeyValueField";

const meta = {
  title: "Components/KeyValueField",
  component: KeyValueField,
  tags: ["autodocs"],
  args: {
    label: "Model",
    value: "SD 1.5",
  },
} satisfies Meta<typeof KeyValueField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Grid: Story = {
  render: (args) => (
    <div className="grid w-96 grid-cols-2 gap-2">
      <KeyValueField {...args} label="Model" value="SD 1.5" />
      <KeyValueField {...args} label="Sampler" value="DPM++ 2M Karras" />
      <KeyValueField {...args} label="Steps" value="28" />
      <KeyValueField {...args} label="CFG" value="7.0" />
      <KeyValueField {...args} label="Seed" value="3268129004" />
      <KeyValueField {...args} label="Size" value="512 × 768" />
    </div>
  ),
};
