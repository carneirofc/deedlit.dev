"use client";

import { useMemo, useState, useEffect } from "react";
import { applyBookFilters } from "@/features/books/lib/filtering";
import type { BookFilterState } from "@/features/books/lib/filtering";
import type { BookItem } from "@/features/books/data/books";

const INITIAL_FILTERS: BookFilterState = {
  query: "",
  sort: "rating-desc",
  selectedGenres: [],
  selectedTags: [],
  minRating: 0,
  minPages: 0,
  maxPages: 0,
};

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[BOOK_FILTERS]', ...args);

/**
 * Custom hook for managing book filtering and sorting state.
 * Provides filter state, filtered results, and update functions.
 * Includes performance logging in development mode.
 * 
 * @param books - Array of books to filter
 * @returns Object containing filters, filteredBooks, and setter functions
 * 
 * @example
 * const { filteredBooks, setQuery, resetFilters } = useBookFilters(books);
 * setQuery('fantasy');
 */
export function useBookFilters(books: BookItem[]) {
  const [filters, setFilters] = useState<BookFilterState>(INITIAL_FILTERS);

  useEffect(() => {
    log('[DEBUG] Initializing book filters with', books.length, 'books');
  }, [books.length]);

  const filteredBooks = useMemo(() => {
    const startTime = performance.now();
    const result = applyBookFilters(books, filters);
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    log(`Filtered ${books.length} books → ${result.length} results in ${duration}ms`, {
      filters: {
        query: filters.query,
        sort: filters.sort,
        genres: filters.selectedGenres,
        tags: filters.selectedTags,
        minRating: filters.minRating
      }
    });
    
    return result;
  }, [books, filters]);

  const setQuery = (query: string) => {
    log('Setting query:', query);
    setFilters((current) => ({ ...current, query }));
  };
  
  const setSort = (sort: BookFilterState["sort"]) => {
    log('Setting sort:', sort);
    setFilters((current) => ({ ...current, sort }));
  };
  
  const setSelectedGenres = (selectedGenres: string[]) => {
    log('Setting genres:', selectedGenres);
    setFilters((current) => ({ ...current, selectedGenres }));
  };
  
  const setSelectedTags = (selectedTags: string[]) => {
    log('Setting tags:', selectedTags);
    setFilters((current) => ({ ...current, selectedTags }));
  };
  
  const setMinRating = (minRating: number) => {
    log('Setting min rating:', minRating);
    setFilters((current) => ({ ...current, minRating }));
  };
  
  const setMinPages = (minPages: number) => setFilters((current) => ({ ...current, minPages }));
  const setMaxPages = (maxPages: number) => setFilters((current) => ({ ...current, maxPages }));
  
  const resetFilters = () => {
    log('Resetting all filters');
    setFilters(INITIAL_FILTERS);
  };

  return {
    filters,
    filteredBooks,
    setQuery,
    setSort,
    setSelectedGenres,
    setSelectedTags,
    setMinRating,
    setMinPages,
    setMaxPages,
    resetFilters,
  };
}
