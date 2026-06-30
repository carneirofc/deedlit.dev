import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import ConfirmationDialog from "./ConfirmationDialog";
import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/ConfirmationDialog",
  component: ConfirmationDialog,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const DIALOG = {
  title: "Delete 3 source directories?",
  details: [
    "/library/illustrations — 642 images",
    "/library/renders — 418 images",
    "/library/inbox — 144 images",
  ],
  outcomes: [
    "The directories are removed from the scan configuration.",
    "Indexed metadata for 1,204 images is discarded.",
    "Files on disk are left untouched.",
  ],
  confirmLabel: "Delete roots",
  cancelLabel: "Keep them",
};

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    return (
      <div className="grid min-h-[70vh] place-items-center gap-3">
        <OutlineButton variant="danger" onClick={() => setOpen(true)}>
          Delete roots
        </OutlineButton>
        {result && <p className="text-ui-sm text-[color:var(--ui-ink-secondary)]">Last choice: {result}</p>}
        {open && (
          <ConfirmationDialog
            dialog={DIALOG}
            onClose={(accepted) => {
              setResult(accepted ? "confirmed" : "cancelled");
              setOpen(false);
            }}
          />
        )}
      </div>
    );
  },
};
