import type { Meta, StoryObj } from "@storybook/react-vite";

import WarningList from "./WarningList";

const meta = {
  title: "Components/WarningList",
  component: WarningList,
  tags: ["autodocs"],
  args: {
    warnings: [
      "3 files were skipped because they are not images.",
      "Sidecar JSON could not be parsed for 2 items.",
    ],
  },
} satisfies Meta<typeof WarningList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Single: Story = {
  args: { warnings: ["The selected directory is empty."] },
};

/** Renders nothing when there are no warnings. */
export const Empty: Story = {
  args: { warnings: [] },
};
