import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/OutlineButton",
  component: OutlineButton,
  tags: ["autodocs"],
  args: {
    children: "Button",
    variant: "neutral",
    controlSize: "sm",
    onClick: fn(),
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["neutral", "danger", "ghost", "accent"],
    },
    controlSize: {
      control: "inline-radio",
      options: ["xs", "sm", "md", "lg", "icon"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof OutlineButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Accent: Story = { args: { variant: "accent", children: "Run scan" } };

export const Danger: Story = { args: { variant: "danger", children: "Delete" } };

export const Ghost: Story = { args: { variant: "ghost", children: "Ghost" } };

export const Disabled: Story = { args: { disabled: true } };

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <OutlineButton {...args} variant="neutral">
        Neutral
      </OutlineButton>
      <OutlineButton {...args} variant="accent">
        Accent
      </OutlineButton>
      <OutlineButton {...args} variant="ghost">
        Ghost
      </OutlineButton>
      <OutlineButton {...args} variant="danger">
        Danger
      </OutlineButton>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <OutlineButton {...args} controlSize="xs">
        xs
      </OutlineButton>
      <OutlineButton {...args} controlSize="sm">
        sm
      </OutlineButton>
      <OutlineButton {...args} controlSize="md">
        md
      </OutlineButton>
      <OutlineButton {...args} controlSize="lg">
        lg
      </OutlineButton>
    </div>
  ),
};
