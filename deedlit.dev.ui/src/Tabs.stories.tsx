import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="details" className="w-96">
      <TabsList className="w-full">
        <TabsTrigger value="details" className="flex-1">
          Details
        </TabsTrigger>
        <TabsTrigger value="workflow" className="flex-1">
          Workflow
        </TabsTrigger>
        <TabsTrigger value="raw" className="flex-1">
          Raw
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="mt-3 text-ui-sm text-[color:var(--ui-ink-secondary)]">
        Arrow keys move between tabs; each panel is linked via aria-controls.
      </TabsContent>
      <TabsContent value="workflow" className="mt-3 text-ui-sm text-[color:var(--ui-ink-secondary)]">
        Workflow graph and node parameters.
      </TabsContent>
      <TabsContent value="raw" className="mt-3 font-mono text-ui-xs text-[color:var(--ui-ink-secondary)]">
        {"{ \"steps\": 28, \"cfg\": 7 }"}
      </TabsContent>
    </Tabs>
  ),
};
