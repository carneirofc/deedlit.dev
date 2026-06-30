import type { Meta, StoryObj } from "@storybook/react-vite";

import StatusMessage from "./StatusMessage";

const meta = {
  title: "Components/StatusMessage",
  component: StatusMessage,
  tags: ["autodocs"],
  args: {
    role: "status",
    tone: "info",
    children: "Indexing 1,204 images — this may take a moment.",
  },
  argTypes: {
    role: { control: "inline-radio", options: ["status", "alert"] },
    tone: { control: "inline-radio", options: ["info", "success", "warn", "error"] },
  },
} satisfies Meta<typeof StatusMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col gap-2">
      <StatusMessage {...args} tone="info">
        Indexing in progress…
      </StatusMessage>
      <StatusMessage {...args} tone="success">
        Library synced successfully.
      </StatusMessage>
      <StatusMessage {...args} tone="warn">
        Some files were skipped.
      </StatusMessage>
      <StatusMessage {...args} role="alert" tone="error">
        Scan failed — check the source path.
      </StatusMessage>
    </div>
  ),
};
