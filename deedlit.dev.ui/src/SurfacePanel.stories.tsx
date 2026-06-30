import type { Meta, StoryObj } from "@storybook/react-vite";

import SurfacePanel from "./SurfacePanel";

const meta = {
  title: "Components/SurfacePanel",
  component: SurfacePanel,
  tags: ["autodocs"],
  args: {
    tone: "default",
    padding: "md",
    children: "Surface panel content",
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["default", "soft", "subtle", "strong"] },
    padding: { control: "inline-radio", options: ["none", "sm", "md", "lg"] },
  },
} satisfies Meta<typeof SurfacePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="grid w-96 grid-cols-2 gap-3">
      <SurfacePanel {...args} tone="default">
        default
      </SurfacePanel>
      <SurfacePanel {...args} tone="soft">
        soft
      </SurfacePanel>
      <SurfacePanel {...args} tone="subtle">
        subtle
      </SurfacePanel>
      <SurfacePanel {...args} tone="strong">
        strong
      </SurfacePanel>
    </div>
  ),
};
