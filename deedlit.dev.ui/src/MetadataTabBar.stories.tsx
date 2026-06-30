import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import MetadataTabBar, { type MetadataTabValue } from "./MetadataTabBar";

const meta = {
  title: "Components/MetadataTabBar",
  component: MetadataTabBar,
  tags: ["autodocs"],
} satisfies Meta<typeof MetadataTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<MetadataTabValue>("details");
    return (
      <div className="w-96">
        <MetadataTabBar value={value} onValueChange={setValue} />
        <div className="mt-3 text-ui-sm text-[color:var(--ui-ink-secondary)]">
          Active tab: <strong>{value}</strong>
        </div>
      </div>
    );
  },
};
