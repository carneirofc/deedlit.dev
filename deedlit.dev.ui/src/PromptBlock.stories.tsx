import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import PromptBlock from "./PromptBlock";

const meta = {
  title: "Components/PromptBlock",
  component: PromptBlock,
  tags: ["autodocs"],
  args: {
    label: "Positive Prompt",
    tone: "positive",
    children: "masterpiece, best quality, cinematic lighting, depth of field, 8k",
    onCopy: fn(),
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["positive", "negative", "neutral"] },
  },
} satisfies Meta<typeof PromptBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positive: Story = {
  render: (args) => (
    <div className="w-96">
      <PromptBlock {...args} />
    </div>
  ),
};

export const Negative: Story = {
  args: { label: "Negative Prompt", tone: "negative", children: "blurry, lowres, watermark, text, jpeg artifacts" },
  render: (args) => (
    <div className="w-96">
      <PromptBlock {...args} />
    </div>
  ),
};

export const Interactive: Story = {
  render: (args) => {
    const [copied, setCopied] = useState(false);
    return (
      <div className="w-96">
        <PromptBlock
          {...args}
          copied={copied}
          onCopy={() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        />
      </div>
    );
  },
};
