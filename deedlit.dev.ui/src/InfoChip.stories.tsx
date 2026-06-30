import type { Meta, StoryObj } from "@storybook/react-vite";

import InfoChip from "./InfoChip";

const meta = {
  title: "Components/InfoChip",
  component: InfoChip,
  tags: ["autodocs"],
  args: {
    children: "masterpiece",
  },
} satisfies Meta<typeof InfoChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Group: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <InfoChip {...args}>masterpiece</InfoChip>
      <InfoChip {...args}>cinematic lighting</InfoChip>
      <InfoChip {...args}>depth of field</InfoChip>
      <InfoChip {...args}>ponyXL</InfoChip>
    </div>
  ),
};
