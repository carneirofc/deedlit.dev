import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

import { Gallery, type GalleryViewMode } from "./Gallery";

interface Tile {
  id: string;
  index: number;
  hue: number;
}

function makeTiles(count: number): Tile[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tile-${index}`,
    index,
    hue: (index * 37) % 360,
  }));
}

const meta = {
  title: "Components/Gallery",
  component: Gallery,
  parameters: { layout: "fullscreen" },
  // Required-prop placeholders so StoryObj typechecks; each story's `render`
  // supplies the real items / slots.
  args: {
    items: [] as Tile[],
    getKey: (t: Tile) => t.id,
    renderMedia: () => null,
  },
} satisfies Meta<typeof Gallery<Tile>>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Large list exercising the always-on sliding window. Only a window of cards is
 * mounted around the viewport; the `data-testid="mounted-count"` badge reports
 * how many `[data-gallery-item]` nodes exist so a scroll never leaves a blank.
 * Each tile prints its absolute index, so the mounted range is verifiable.
 */
export const Windowed: Story = {
  render: () => {
    const [view, setView] = useState<GalleryViewMode>("grid");
    const items = useMemo(() => makeTiles(500), []);
    return (
      <div className="min-h-screen bg-ui-bg-deep p-4 text-ui-ink">
        <div className="sticky top-0 z-10 mb-4 flex items-center gap-3 bg-ui-bg-deep/90 py-2 backdrop-blur">
          {(["grid", "masonry", "list"] as GalleryViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 text-sm ${view === v ? "bg-accent-cyan text-ui-bg-deep" : "bg-ui-bg-soft"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <Gallery<Tile>
          items={items}
          getKey={(t) => t.id}
          viewMode={view}
          windowing={{ pageSize: 40, pages: 5 }}
          gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
          masonryClassName="columns-2 gap-3 sm:columns-4 lg:columns-6"
          listClassName="flex flex-col gap-2"
          cardClassName="overflow-hidden rounded-lg"
          renderMedia={(t, ctx) => (
            <div
              data-testid={`tile-${t.index}`}
              className={
                ctx.viewMode === "list"
                  ? "flex h-16 w-16 items-center justify-center text-sm font-bold text-black"
                  : ctx.viewMode === "masonry"
                    ? "flex items-center justify-center text-lg font-bold text-black"
                    : "flex aspect-square items-center justify-center text-lg font-bold text-black"
              }
              style={{
                backgroundColor: `hsl(${t.hue} 70% 60%)`,
                // Vary masonry heights so the column layout is real.
                height: ctx.viewMode === "masonry" ? 120 + (t.index % 5) * 40 : undefined,
              }}
            >
              {t.index}
            </div>
          )}
        />
      </div>
    );
  },
};
