"use client";

import { useState } from "react";
import type { BookFilterState } from "@/features/books/lib/filtering";

interface BookFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  sort: BookFilterState["sort"];
  onSortChange: (value: BookFilterState["sort"]) => void;
  selectedGenres: string[];
  onGenresChange: (genres: string[]) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  minRating: number;
  onMinRatingChange: (rating: number) => void;
  availableGenres: string[];
  availableTags: string[];
  filteredCount: number;
  totalCount: number;
  onReset: () => void;
}

export function BookFilters({
  query,
  onQueryChange,
  sort,
  onSortChange,
  selectedGenres,
  onGenresChange,
  selectedTags,
  onTagsChange,
  minRating,
  onMinRatingChange,
  availableGenres,
  availableTags,
  filteredCount,
  totalCount,
  onReset,
}: BookFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleGenre = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const hasActiveFilters = 
    query.length > 0 || 
    selectedGenres.length > 0 || 
    selectedTags.length > 0 || 
    minRating > 0;

  return (
    <div className="sticky top-[4.2rem] z-20 mb-4 transition-all duration-300">
      {/* Compact Search and Sort Row */}
      <div className="rounded-lg border border-line/80 bg-surface/95 p-3 shadow-sm backdrop-blur transition-all duration-200 hover:shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-0 sm:min-w-[12rem]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search books..."
              className="focus-ring w-full rounded-md border border-line/80 bg-base/50 pl-9 pr-3 py-2 text-sm text-text placeholder:text-muted transition-all duration-200 hover:border-line focus:border-accent focus:bg-base"
            />
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
            </svg>
            <select
              id="sort"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as BookFilterState["sort"])}
              className="focus-ring appearance-none rounded-md border border-line/80 bg-base/50 pl-9 pr-8 py-2 text-sm text-text font-medium transition-all duration-200 hover:border-line focus:border-accent focus:bg-base cursor-pointer"
            >
              <option value="rating-desc">★ High</option>
              <option value="rating-asc">★ Low</option>
              <option value="year-desc">Newest</option>
              <option value="year-asc">Oldest</option>
              <option value="title-asc">A-Z</option>
              <option value="title-desc">Z-A</option>
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="focus-ring flex items-center gap-1.5 rounded-md border border-line/80 bg-base/50 px-3 py-2 text-xs font-medium text-text hover:bg-base hover:border-line transition-all duration-200"
          >
            <svg className={`h-3.5 w-3.5 text-accent transition-transform duration-300 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            {isExpanded ? 'Less' : 'Filters'}
          </button>
          
          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="focus-ring flex items-center gap-1.5 rounded-md border border-line/80 bg-base/50 px-3 py-2 text-xs font-medium text-text hover:bg-base hover:border-line transition-all duration-200 animate-in fade-in slide-in-from-right-2"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reset
            </button>
          )}
          
          <span className="ml-auto whitespace-nowrap text-xs font-semibold text-text">
            {filteredCount}/{totalCount}
          </span>
        </div>
      </div>

      {/* Expandable Advanced Filters */}
      {isExpanded && (
        <div className="mt-2 rounded-lg border border-line/80 bg-surface/95 p-4 shadow-sm backdrop-blur animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-4">
            {/* Rating Filter */}
            <div>
              <label htmlFor="rating" className="mb-1.5 block text-xs font-semibold text-text">
                Min Rating: {minRating > 0 ? minRating.toFixed(1) : 'Any'}
              </label>
              <input
                id="rating"
                type="range"
                min="0"
                max="5"
                step="0.5"
                value={minRating}
                onChange={(e) => onMinRatingChange(parseFloat(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-accent bg-line/30 transition-all duration-200"
                style={{
                  background: `linear-gradient(to right, rgb(var(--accent)) 0%, rgb(var(--accent)) ${(minRating / 5) * 100}%, rgb(var(--line) / 0.3) ${(minRating / 5) * 100}%, rgb(var(--line) / 0.3) 100%)`
                }}
              />
            </div>

            {/* Genre Pills */}
            {availableGenres.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-text">Genres</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableGenres.map((genre) => {
                    const isSelected = selectedGenres.includes(genre);
                    return (
                      <button
                        key={genre}
                        onClick={() => toggleGenre(genre)}
                        className={`focus-ring rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 transform hover:scale-105 ${
                          isSelected
                            ? 'bg-accent text-white shadow-sm scale-105'
                            : 'bg-base text-muted hover:bg-accent/10 hover:text-accent border border-line/60 hover:border-accent/40'
                        }`}
                      >
                        {genre}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tag Pills */}
            {availableTags.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-text">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`focus-ring rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 transform hover:scale-105 ${
                          isSelected
                            ? 'bg-accent text-white shadow-sm scale-105'
                            : 'bg-base text-muted hover:bg-accent/10 hover:text-accent border border-line/60 hover:border-accent/40'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
