interface GalleryFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  sort: "created-desc" | "created-asc" | "title-asc" | "title-desc";
  onSortChange: (value: "created-desc" | "created-asc" | "title-asc" | "title-desc") => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  filteredCount: number;
  totalCount: number;
}

export function GalleryFilters({
  query,
  onQueryChange,
  sort,
  onSortChange,
  searchRef,
  filteredCount,
  totalCount
}: GalleryFiltersProps) {
  return (
    <div className="sticky top-[4.2rem] z-20 mb-4 rounded-xl2 border border-line/80 bg-surface/92 p-2 shadow-soft backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="search" className="sr-only">
          Search
        </label>
        <input
          id="search"
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search image id"
          className="focus-ring min-w-0 flex-1 rounded-lg border border-line/90 bg-base/70 px-3 py-2 text-sm sm:min-w-[16rem]"
        />
        <label htmlFor="sort" className="sr-only">
          Sort
        </label>
        <select
          id="sort"
          value={sort}
          onChange={(event) =>
            onSortChange(
              event.target.value as "created-desc" | "created-asc" | "title-asc" | "title-desc"
            )
          }
          className="focus-ring rounded-lg border border-line/90 bg-base/70 px-3 py-2 text-sm text-muted"
        >
          <option value="created-desc">Newest first</option>
          <option value="created-asc">Oldest first</option>
          <option value="title-asc">Title A-Z</option>
          <option value="title-desc">Title Z-A</option>
        </select>
        <p className="whitespace-nowrap px-2 text-xs text-muted">
          {filteredCount}/{totalCount}
        </p>
      </div>
    </div>
  );
}
