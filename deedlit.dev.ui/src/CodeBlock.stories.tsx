import type { Meta, StoryObj } from "@storybook/react-vite";

import CodeBlock from "./CodeBlock";

const SAMPLE = `{
  "prompt": "masterpiece, cinematic lighting, depth of field",
  "negative_prompt": "blurry, lowres, watermark",
  "steps": 28,
  "sampler": "DPM++ 2M Karras",
  "cfg_scale": 7,
  "seed": 3268129004,
  "size": "512x768",
  "model": "sd_v1-5"
}`;

const meta = {
  title: "Components/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
  args: {
    children: SAMPLE,
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-[32rem]">
      <CodeBlock {...args} />
    </div>
  ),
};

export const Constrained: Story = {
  args: { maxHeight: "max-h-32" },
  render: (args) => (
    <div className="w-[32rem]">
      <CodeBlock {...args} />
    </div>
  ),
};
