import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import DropdownMenu from "./DropdownMenu";
import OutlineButton from "./OutlineButton";
import { CheckIcon } from "./Icons";

const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    trigger: <OutlineButton>Sort by…</OutlineButton>,
    items: [
      { key: "recent", label: "Most recent", onClick: fn() },
      { key: "name", label: "Name (A–Z)", onClick: fn() },
      { key: "rating", label: "Highest rated", onClick: fn() },
    ],
  },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIndicators: Story = {
  args: {
    trigger: <OutlineButton>Filter tags</OutlineButton>,
    align: "left",
    items: [
      {
        key: "sfw",
        label: "Safe",
        indicator: <span className="h-2 w-2 rounded-full bg-emerald-400" />,
        trailing: <CheckIcon size="h-3.5 w-3.5" />,
        onClick: fn(),
      },
      {
        key: "nsfw",
        label: "Suggestive",
        indicator: <span className="h-2 w-2 rounded-full bg-amber-400" />,
        onClick: fn(),
      },
      {
        key: "explicit",
        label: "Explicit",
        indicator: <span className="h-2 w-2 rounded-full bg-rose-400" />,
        onClick: fn(),
      },
    ],
  },
};
