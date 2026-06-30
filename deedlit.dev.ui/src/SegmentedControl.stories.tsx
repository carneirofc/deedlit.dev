import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import SegmentedControl from "./SegmentedControl";

const meta = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [mode, setMode] = useState<"and" | "or">("and");
    return (
      <SegmentedControl
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "and", label: "AND" },
          { value: "or", label: "OR" },
        ]}
      />
    );
  },
};

export const ManyOptions: Story = {
  render: () => {
    const [view, setView] = useState("grid");
    return (
      <SegmentedControl
        value={view}
        onValueChange={setView}
        options={[
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
          { value: "masonry", label: "Masonry" },
          { value: "table", label: "Table", disabled: true },
        ]}
      />
    );
  },
};
