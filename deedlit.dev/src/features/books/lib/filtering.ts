import type { BookItem } from "@/features/books/data/books";

export type BookSort = "rating-desc" | "rating-asc" | "year-desc" | "year-asc" | "title-asc" | "title-desc" | "pages-desc" | "pages-asc";

export interface BookFilterState {
  query: string;
  sort: BookSort;
  selectedGenres: string[];
  selectedTags: string[];
  minRating: number;
  minPages: number;
  maxPages: number;
}

/**
 * Normalizes a string for case-insensitive comparison.
 * @param value - The string to normalize
 * @returns Trimmed, lowercase string
 */
function normalize(value: string) {
  return value.toLowerCase().trim();
}

/**
 * Performs fuzzy matching to check if a token appears in the haystack.
 * Matches characters in order but allows gaps between them.
 * @param token - The search token to find
 * @param haystack - The string to search in
 * @returns True if token matches (fuzzy or exact), false otherwise
 * @example fuzzyTokenMatch('wlk', 'walk') // true
 * @example fuzzyTokenMatch('run', 'walk') // false
 */
function fuzzyTokenMatch(token: string, haystack: string) {
  if (haystack.includes(token)) return true;

  let index = 0;
  for (const char of haystack) {
    if (char === token[index]) {
      index += 1;
      if (index === token.length) return true;
    }
  }

  return false;
}

/**
 * Checks if a book matches the search query using fuzzy token matching.
 * Searches across title, author, note, and description fields.
 * @param query - The search query string
 * @param book - The book to check
 * @returns True if book matches query (or query is empty), false otherwise
 */
function matchesQuery(query: string, book: BookItem) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const haystack = normalize(`${book.title} ${book.author} ${book.note} ${book.description}`);
  return tokens.every((token) => fuzzyTokenMatch(token, haystack));
}

/**
 * Applies all active filters and sorting to a book collection.
 * Filters by query, genres, tags, rating, and page count, then sorts by selected criteria.
 * @param books - Array of books to filter and sort
 * @param state - Current filter state with query, sort, and filter selections
 * @returns Filtered and sorted array of books
 */
export function applyBookFilters(books: BookItem[], state: BookFilterState) {
  const filtered = books.filter((book) => {
    // Query filter
    if (!matchesQuery(state.query, book)) return false;

    // Genre filter
    if (state.selectedGenres.length > 0) {
      const hasMatchingGenre = state.selectedGenres.some(genre => 
        book.genres.includes(genre)
      );
      if (!hasMatchingGenre) return false;
    }

    // Tag filter
    if (state.selectedTags.length > 0) {
      const hasMatchingTag = state.selectedTags.some(tag => 
        book.tags.includes(tag)
      );
      if (!hasMatchingTag) return false;
    }

    // Rating filter
    if (book.rating < state.minRating) return false;

    // Pages filter
    if (book.pages < state.minPages || (state.maxPages > 0 && book.pages > state.maxPages)) {
      return false;
    }

    return true;
  });

  // Sort
  return filtered.slice().sort((a, b) => {
    switch (state.sort) {
      case "title-asc":
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
      case "title-desc":
        return b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: "base" });
      case "rating-desc":
        return b.rating - a.rating;
      case "rating-asc":
        return a.rating - b.rating;
      case "year-desc":
        return b.year - a.year;
      case "year-asc":
        return a.year - b.year;
      case "pages-desc":
        return b.pages - a.pages;
      case "pages-asc":
        return a.pages - b.pages;
      default:
        return 0;
    }
  });
}

/**
 * Checks if an event target is a text input element.
 * Used to prevent keyboard shortcuts from firing while typing in form fields.
 * @param target - The event target to check
 * @returns True if target is a text input, textarea, select, or contenteditable element
 */
export function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
