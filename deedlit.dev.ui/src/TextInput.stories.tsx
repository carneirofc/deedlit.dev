import type { Meta, StoryObj } from "@storybook/react-vite";

import TextInput from "./TextInput";

const meta = {
  title: "Components/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  args: {
    placeholder: "cinematic portrait, rim lighting",
    controlSize: "md",
  },
  argTypes: {
    controlSize: { control: "inline-radio", options: ["sm", "md"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { controlSize: "sm" } };

export const Disabled: Story = { args: { disabled: true, value: "locked value" } };
