import type { Meta, StoryObj } from "@storybook/react-vite";

import StatusBadge from "./StatusBadge";

const meta = {
  title: "Components/StatusBadge",
  component: StatusBadge,
  tags: ["autodocs"],
  args: {
    tone: "neutral",
    children: "Queued",
  },
  argTypes: {
    tone: {
      control: "inline-radio",
      options: ["neutral", "success", "warn", "error"],
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge {...args} tone="neutral">
        Queued
      </StatusBadge>
      <StatusBadge {...args} tone="success">
        Complete
      </StatusBadge>
      <StatusBadge {...args} tone="warn">
        Scanning
      </StatusBadge>
      <StatusBadge {...args} tone="error">
        Failed
      </StatusBadge>
    </div>
  ),
};
