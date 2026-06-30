import type { Meta, StoryObj } from "@storybook/react-vite";

import TextAreaInput from "./TextAreaInput";

const meta = {
  title: "Components/TextAreaInput",
  component: TextAreaInput,
  tags: ["autodocs"],
  args: {
    controlSize: "md",
    placeholder: "Describe the image…",
    rows: 4,
  },
  argTypes: {
    controlSize: { control: "inline-radio", options: ["sm", "md"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof TextAreaInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-80">
      <TextAreaInput {...args} />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col gap-3">
      <TextAreaInput {...args} controlSize="sm" placeholder="sm" />
      <TextAreaInput {...args} controlSize="md" placeholder="md" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Read-only content" },
  render: (args) => (
    <div className="w-80">
      <TextAreaInput {...args} />
    </div>
  ),
};
