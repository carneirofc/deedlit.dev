import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import Toast from "./Toast";
import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/Toast",
  component: Toast,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    tone: { control: "inline-radio", options: ["info", "success", "warn", "error"] },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { tone: "success" },
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <OutlineButton onClick={() => setOpen(true)}>Show toast</OutlineButton>
        <Toast
          {...args}
          open={open}
          title="Library synced"
          description="1,204 images indexed across 3 source directories."
          onClose={() => setOpen(false)}
        />
      </div>
    );
  },
};

export const Error: Story = {
  args: { tone: "error" },
  render: (args) => (
    <div className="min-h-[40vh]">
      <Toast
        {...args}
        title="Scan failed"
        description="Could not read the source path. Check that the directory exists."
      />
    </div>
  ),
};
