import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <OutlineButton>Open dialog</OutlineButton>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>
            Focus is trapped, the background is inert, and Escape or the backdrop dismisses the dialog.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-ui-sm text-[color:var(--ui-ink-secondary)]">
            Any unsaved edits to this prompt will be lost. This action cannot be undone.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <OutlineButton variant="ghost">Cancel</OutlineButton>
          </DialogClose>
          <DialogClose asChild>
            <OutlineButton variant="accent">Discard</OutlineButton>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const LargeBodyScroll: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <OutlineButton>Open long dialog</OutlineButton>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Scan report</DialogTitle>
          <DialogDescription>The body scrolls while header and footer stay pinned.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-2">
            {Array.from({ length: 40 }).map((_, index) => (
              <p key={index} className="text-ui-sm text-[color:var(--ui-ink-secondary)]">
                Row {index + 1}: indexed 24 images, 0 errors.
              </p>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <OutlineButton variant="accent">Done</OutlineButton>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
