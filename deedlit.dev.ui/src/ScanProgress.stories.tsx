import type { Meta, StoryObj } from "@storybook/react-vite";

import ScanProgress from "./ScanProgress";

const meta = {
  title: "Components/ScanProgress",
  component: ScanProgress,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ScanProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With no `progressPercent`, the bar animates through its staged labels on a timer. */
export const Indeterminate: Story = {
  args: { rootCount: 3 },
  render: (args) => (
    <div className="w-96">
      <ScanProgress {...args} />
    </div>
  ),
};

/** Drive the bar from real progress by passing `progressPercent` + counts. */
export const Determinate: Story = {
  args: {
    progressPercent: 64,
    processedCount: 770,
    totalCount: 1204,
    statusLabel: "Reading sidecar JSON metadata",
  },
  render: (args) => (
    <div className="w-96">
      <ScanProgress {...args} />
    </div>
  ),
};
