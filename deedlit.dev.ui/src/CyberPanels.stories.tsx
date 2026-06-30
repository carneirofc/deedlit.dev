import type { Meta, StoryObj } from "@storybook/react-vite";

import { CyberPanel, CyberSubpanel } from "./CyberPanels";

/**
 * `CyberPanel` is the signature hero surface (glass + neon gradient);
 * `CyberSubpanel` is the lighter nested grouping surface. Both wrap the
 * `.cyber-*` classes documented under **Foundations / Cyber Styles**.
 */
const meta = {
  title: "Components/CyberPanels",
  component: CyberPanel,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof CyberPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {
  render: () => (
    <CyberPanel className="w-[28rem]">
      <p className="cyber-title text-ui-lg font-semibold">Image library</p>
      <p className="cyber-muted mt-1 text-ui-sm">1,204 images indexed across 3 source directories.</p>
    </CyberPanel>
  ),
};

export const Nested: Story = {
  render: () => (
    <CyberPanel className="w-[28rem]">
      <p className="cyber-title text-ui-lg font-semibold">Scan</p>
      <CyberSubpanel className="mt-4">
        <p className="text-ui-sm font-medium">Source directories</p>
        <p className="cyber-muted mt-1 text-ui-xs">/library/illustrations · /library/renders</p>
      </CyberSubpanel>
      <CyberSubpanel className="mt-3">
        <p className="text-ui-sm font-medium">Schedule</p>
        <p className="cyber-muted mt-1 text-ui-xs">Auto-refresh every 15 minutes</p>
      </CyberSubpanel>
    </CyberPanel>
  ),
};
