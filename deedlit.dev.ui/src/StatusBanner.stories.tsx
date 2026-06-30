import type { Meta, StoryObj } from "@storybook/react-vite";

import StatusBanner from "./StatusBanner";

const meta = {
  title: "Components/StatusBanner",
  component: StatusBanner,
  tags: ["autodocs"],
  args: {
    tone: "loading",
    children: "Loading metadata…",
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["loading", "error"] },
  },
} satisfies Meta<typeof StatusBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

export const Error: Story = {
  args: { tone: "error", children: "Could not read the source path." },
};

export const Both: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col gap-2">
      <StatusBanner {...args} tone="loading">
        Loading metadata…
      </StatusBanner>
      <StatusBanner {...args} tone="error">
        Could not read the source path.
      </StatusBanner>
    </div>
  ),
};
