import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import Pagination from "./Pagination";

const meta = {
  title: "Components/Pagination",
  component: Pagination,
  tags: ["autodocs"],
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const totalPages = 5;
    const [page, setPage] = useState(1);
    return (
      <div className="w-80">
        <Pagination
          page={page}
          totalPages={totalPages}
          onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      </div>
    );
  },
};

export const FirstPage: Story = {
  render: () => (
    <div className="w-80">
      <Pagination page={1} totalPages={5} onPrevPage={() => {}} onNextPage={() => {}} />
    </div>
  ),
};

export const LastPage: Story = {
  render: () => (
    <div className="w-80">
      <Pagination page={5} totalPages={5} onPrevPage={() => {}} onNextPage={() => {}} />
    </div>
  ),
};
