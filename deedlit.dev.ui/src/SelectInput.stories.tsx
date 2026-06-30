import type { Meta, StoryObj } from "@storybook/react-vite";

import SelectInput from "./SelectInput";

const meta = {
  title: "Components/SelectInput",
  component: SelectInput,
  tags: ["autodocs"],
  args: {
    controlSize: "md",
    defaultValue: "ponyXL",
  },
  argTypes: {
    controlSize: { control: "inline-radio", options: ["sm", "md"] },
    disabled: { control: "boolean" },
  },
  render: (args) => (
    <SelectInput {...args}>
      <option value="ponyXL">ponyXL</option>
      <option value="sdxl-lightning">sdxl-lightning</option>
      <option value="flux-dev">flux-dev</option>
    </SelectInput>
  ),
} satisfies Meta<typeof SelectInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { controlSize: "sm" } };

export const Disabled: Story = { args: { disabled: true } };
