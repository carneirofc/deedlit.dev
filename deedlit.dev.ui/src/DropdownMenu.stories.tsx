import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./DropdownMenu";
import OutlineButton from "./OutlineButton";
import { CheckIcon } from "./Icons";

const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <OutlineButton>Sort by…</OutlineButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={fn()}>Most recent</DropdownMenuItem>
        <DropdownMenuItem onSelect={fn()}>Name (A–Z)</DropdownMenuItem>
        <DropdownMenuItem onSelect={fn()}>Highest rated</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithIndicators: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <OutlineButton>Filter tags</OutlineButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Safety class</DropdownMenuLabel>
        <DropdownMenuItem onSelect={fn()}>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="flex-1">Safe</span>
          <CheckIcon size="h-3.5 w-3.5" />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={fn()}>
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="flex-1">Suggestive</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={fn()}>
          <span className="h-2 w-2 rounded-full bg-rose-400" />
          <span className="flex-1">Explicit</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
