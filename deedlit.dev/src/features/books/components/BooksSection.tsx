"use client";

import type { BookItem } from "@/features/books/data/books";
import { allGenres, allTags } from "@/features/books/data/books";
import { useBookFilters } from "@/features/books/hooks/useBookFilters";
import { BookFilters } from "@/features/books/components/BookFilters";

interface BooksSectionProps {
  items: BookItem[];
}

export function BooksSection({ items }: BooksSectionProps) {
  const {
    filters,
    filteredBooks,
    setQuery,
    setSort,
    setSelectedGenres,
    setSelectedTags,
    setMinRating,
    resetFilters,
  } = useBookFilters(items);

  return (
    <section id="books" className="section-anchor mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold">Books</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-text sm:text-3xl">
          Reference shelf
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted leading-relaxed">
          My personal library of physical books, organized and cataloged. These are titles I keep around, revisit, and recommend. I may write about some of these in future blog posts.
        </p>
      </div>

      <BookFilters
        query={filters.query}
        onQueryChange={setQuery}
        sort={filters.sort}
        onSortChange={setSort}
        selectedGenres={filters.selectedGenres}
        onGenresChange={setSelectedGenres}
        selectedTags={filters.selectedTags}
        onTagsChange={setSelectedTags}
        minRating={filters.minRating}
        onMinRatingChange={setMinRating}
        availableGenres={allGenres}
        availableTags={allTags}
        filteredCount={filteredBooks.length}
        totalCount={items.length}
        onReset={resetFilters}
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filteredBooks.map((book) => (
          <article
            key={book.id}
            className="group rounded-xl border border-line/80 bg-surface/90 p-5 shadow-soft transition-all hover:shadow-md hover:border-line backdrop-blur-sm"
          >
            <div className="flex gap-4">
              {/* Book Cover */}
              <div className="shrink-0">
                <img
                  src={book.coverUrl}
                  alt={`${book.title} cover`}
                  className="h-32 w-24 rounded object-cover shadow-sm"
                  loading="lazy"
                />
              </div>

              {/* Book Info */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold leading-snug text-text">{book.title}</h3>
                  <div className="flex shrink-0 items-center gap-1 text-sm font-semibold">
                    <svg className="h-4 w-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span className="font-bold text-text">{book.rating.toFixed(2)}</span>
                  </div>
                </div>

                <p className="text-sm font-medium text-text/80">
                  {book.author}
                </p>
                <p className="text-xs text-muted">
                  {book.year}
                </p>

                <div className="mt-2 flex gap-3 text-xs text-muted font-medium">
                  <span>{book.pages}p</span>
                  <span>·</span>
                  <span>{(book.ratingsCount / 1000).toFixed(1)}k ratings</span>
                </div>

                {book.note && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted leading-relaxed">{book.note}</p>
                )}
              </div>
            </div>

            {/* Genres and Tags Row */}
            <div className="mt-4 space-y-2">
              {/* Genres */}
              {book.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {book.genres.slice(0, 4).map((genre) => (
                    <span
                      key={genre}
                      className="rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent border border-accent/20"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {/* Tags */}
              {book.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {book.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Goodreads Link */}
            <a
              href={book.goodreadsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center text-xs font-medium text-accent hover:text-accent/80 transition-colors"
            >
              View on Goodreads
              <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </article>
        ))}
      </div>

      {filteredBooks.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-muted">No books match your filters.</p>
          <button
            onClick={resetFilters}
            className="mt-3 text-sm font-medium text-accent underline hover:text-accent/80 hover:no-underline transition-colors"
          >
            Reset filters
          </button>
        </div>
      )}
    </section>
  );
}
