import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import DockPanel from "./DockPanel";

const meta = {
  title: "Components/DockPanel",
  component: DockPanel,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md", "lg", "xl"] },
  },
} satisfies Meta<typeof DockPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "Selection", badgeCount: 4, size: "md" },
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <div className="min-h-[80vh] p-6 text-ui-sm text-[color:var(--ui-ink-secondary)]">
        Use the toggle pinned to the bottom-right to open the dock.
        <DockPanel {...args} isOpen={open} onOpenChange={setOpen}>
          <ul className="space-y-2">
            {["render_001.png", "render_002.png", "render_003.png", "render_004.png"].map((name) => (
              <li key={name} className="rounded-lg bg-[color:var(--ui-bg-soft)] px-3 py-2">
                {name}
              </li>
            ))}
          </ul>
        </DockPanel>
      </div>
    );
  },
};
