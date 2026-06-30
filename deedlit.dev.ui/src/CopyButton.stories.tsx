import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import CopyButton from "./CopyButton";

const meta = {
  title: "Components/CopyButton",
  component: CopyButton,
  tags: ["autodocs"],
  args: {
    onClick: fn(),
  },
  argTypes: {
    copied: { control: "boolean" },
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Copied: Story = { args: { copied: true } };

/** Wire `copied` to a timeout for the real "Copy → Copied → Copy" feedback. */
export const Interactive: Story = {
  render: (args) => {
    const [copied, setCopied] = useState(false);
    return (
      <CopyButton
        {...args}
        copied={copied}
        onClick={() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
      />
    );
  },
};
