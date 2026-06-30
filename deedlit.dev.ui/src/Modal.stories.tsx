import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import Modal from "./Modal";
import OutlineButton from "./OutlineButton";

const meta = {
  title: "Components/Modal",
  component: Modal,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md", "lg", "xl", "full"] },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: "md" },
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <OutlineButton variant="accent" onClick={() => setOpen(true)}>
          Open modal
        </OutlineButton>
        <Modal
          {...args}
          open={open}
          onClose={() => setOpen(false)}
          title="Delete library?"
          description="This removes the catalog entries but leaves the source files untouched."
          footer={
            <div className="flex justify-end gap-2">
              <OutlineButton onClick={() => setOpen(false)}>Cancel</OutlineButton>
              <OutlineButton variant="danger" onClick={() => setOpen(false)}>
                Delete
              </OutlineButton>
            </div>
          }
        >
          <p className="text-ui-sm text-ui-ink">
            You can re-index the source directory at any time to rebuild the library.
          </p>
        </Modal>
      </div>
    );
  },
};
