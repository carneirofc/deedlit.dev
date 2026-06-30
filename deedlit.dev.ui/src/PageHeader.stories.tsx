import type { Meta, StoryObj } from "@storybook/react-vite";

import PageHeader from "./PageHeader";
import InfoChip from "./InfoChip";

const meta = {
  title: "Components/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  args: {
    subtitle: "deedlit.dev // gallery",
    title: "Image library",
    description: "Browse, tag and inspect every image indexed across your configured source directories.",
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPills: Story = {
  args: {
    pills: (
      <>
        <InfoChip>1,204 images</InfoChip>
        <InfoChip>3 roots</InfoChip>
        <InfoChip>synced 2m ago</InfoChip>
      </>
    ),
  },
};
