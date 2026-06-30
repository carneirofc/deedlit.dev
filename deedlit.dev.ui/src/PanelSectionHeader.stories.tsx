import type { Meta, StoryObj } from "@storybook/react-vite";

import PanelSectionHeader from "./PanelSectionHeader";
import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/PanelSectionHeader",
  component: PanelSectionHeader,
  tags: ["autodocs"],
  args: {
    title: "Source directories",
    description: "Folders scanned when building the image index.",
  },
} satisfies Meta<typeof PanelSectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-[34rem]">
      <PanelSectionHeader {...args} />
    </div>
  ),
};

export const WithActions: Story = {
  render: (args) => (
    <div className="w-[34rem]">
      <PanelSectionHeader
        {...args}
        actions={
          <>
            <OutlineButton controlSize="xs">Refresh</OutlineButton>
            <OutlineButton controlSize="xs" variant="accent">
              Add root
            </OutlineButton>
          </>
        }
      />
    </div>
  ),
};

export const TitleOnly: Story = {
  args: { description: undefined },
  render: (args) => (
    <div className="w-[34rem]">
      <PanelSectionHeader {...args} />
    </div>
  ),
};
