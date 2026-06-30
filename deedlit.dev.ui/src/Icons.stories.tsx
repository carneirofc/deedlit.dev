import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  HeartIcon,
  XIcon,
  TrashIcon,
  FolderIcon,
  FolderPlusIcon,
  DownloadIcon,
  CopyIcon,
  PlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  DocumentPlusIcon,
  ShuffleIcon,
  PlayIcon,
  PauseIcon,
  EditIcon,
} from "./Icons";

/**
 * The bundled stroke icon set. Every icon takes the standard `IconProps`
 * (`size`, `className`, plus SVG attributes) and inherits `currentColor`, so a
 * parent `text-*` class tints it. `HeartIcon` additionally accepts `filled`.
 */
const meta: Meta = {
  title: "Components/Icons",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

const ICONS = [
  ["HeartIcon", HeartIcon],
  ["XIcon", XIcon],
  ["TrashIcon", TrashIcon],
  ["FolderIcon", FolderIcon],
  ["FolderPlusIcon", FolderPlusIcon],
  ["DownloadIcon", DownloadIcon],
  ["CopyIcon", CopyIcon],
  ["PlusIcon", PlusIcon],
  ["CheckIcon", CheckIcon],
  ["ChevronDownIcon", ChevronDownIcon],
  ["ChevronLeftIcon", ChevronLeftIcon],
  ["ChevronRightIcon", ChevronRightIcon],
  ["DocumentIcon", DocumentIcon],
  ["DocumentPlusIcon", DocumentPlusIcon],
  ["ShuffleIcon", ShuffleIcon],
  ["PlayIcon", PlayIcon],
  ["PauseIcon", PauseIcon],
  ["EditIcon", EditIcon],
] as const;

export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-3 text-[color:var(--ui-ink-strong)] sm:grid-cols-4 lg:grid-cols-6">
      {ICONS.map(([name, Icon]) => (
        <div
          key={name}
          className="flex flex-col items-center gap-2 rounded-xl border border-ui bg-[color:var(--ui-bg-card)] px-2 py-4"
        >
          <Icon size="h-6 w-6" />
          <code className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">{name}</code>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-[color:var(--ui-ink-strong)]">
      <HeartIcon size="h-4 w-4" />
      <HeartIcon size="h-6 w-6" />
      <HeartIcon size="h-8 w-8" />
      <HeartIcon size="h-10 w-10" filled className="text-[color:var(--accent-pink)]" />
    </div>
  ),
};
