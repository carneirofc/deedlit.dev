import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import MediaStage from "./MediaStage";

const meta = {
  title: "Components/MediaStage",
  component: MediaStage,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    canNavigate: true,
    onNavigate: fn(),
    navigationVisibility: "hover",
  },
  argTypes: {
    navigationVisibility: { control: "inline-radio", options: ["hover", "always"] },
    canNavigate: { control: "boolean" },
  },
} satisfies Meta<typeof MediaStage>;

export default meta;
type Story = StoryObj<typeof meta>;

const Placeholder = () => (
  <div className="grid h-full min-h-60 w-[28rem] place-items-center bg-[color:var(--ui-bg-deep)] text-ui-sm text-[color:var(--ui-ink-inverse)]">
    media content
  </div>
);

export const Default: Story = {
  render: (args) => (
    <MediaStage {...args}>
      <Placeholder />
    </MediaStage>
  ),
};

export const NavigationAlwaysVisible: Story = {
  args: { navigationVisibility: "always" },
  render: (args) => (
    <MediaStage {...args}>
      <Placeholder />
    </MediaStage>
  ),
};

export const SingleItem: Story = {
  args: { canNavigate: false },
  render: (args) => (
    <MediaStage {...args}>
      <Placeholder />
    </MediaStage>
  ),
};
