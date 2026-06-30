import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

const meta = {
  title: "Components/Table",
  component: Table,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS = [
  { dir: "/library/illustrations", images: 642, scanned: "2 min ago" },
  { dir: "/library/renders", images: 418, scanned: "2 min ago" },
  { dir: "/library/inbox", images: 144, scanned: "12 min ago" },
];

export const Default: Story = {
  render: () => (
    <div className="w-[40rem] overflow-hidden rounded-xl border border-ui bg-[color:var(--ui-bg-card)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source directory</TableHead>
            <TableHead className="text-right">Images</TableHead>
            <TableHead className="text-right">Last scan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.dir}>
              <TableCell className="font-medium">{row.dir}</TableCell>
              <TableCell className="text-right">{row.images}</TableCell>
              <TableCell className="text-right text-[color:var(--ui-ink-subtle)]">{row.scanned}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-semibold">1,204</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
};

export const WithCaption: Story = {
  render: () => (
    <div className="w-[40rem]">
      <Table>
        <TableCaption>Indexed source directories, newest scan first.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Source directory</TableHead>
            <TableHead className="text-right">Images</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.dir}>
              <TableCell className="font-medium">{row.dir}</TableCell>
              <TableCell className="text-right">{row.images}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};
