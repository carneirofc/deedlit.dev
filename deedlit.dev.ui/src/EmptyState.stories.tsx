import type { Meta, StoryObj } from "@storybook/react-vite";

import EmptyState from "./EmptyState";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  args: {
    tone: "default",
    children: "No images match the current filters.",
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["default", "subtle"] },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Subtle: Story = { args: { tone: "subtle" } };
