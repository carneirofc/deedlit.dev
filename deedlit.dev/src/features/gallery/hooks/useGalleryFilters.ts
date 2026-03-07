"use client";

import { useMemo, useState, useEffect } from "react";
import { applyGalleryFilters } from "@/features/gallery/lib/filtering";
import type { GalleryFilterState } from "@/features/gallery/lib/filtering";
import type { ImageAsset } from "@/features/gallery/types";

const INITIAL_FILTERS: GalleryFilterState = {
  query: "",
  sort: "created-desc"
};

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[GALLERY_FILTERS]', ...args);

export function useGalleryFilters(assets: ImageAsset[]) {
  const [filters, setFilters] = useState<GalleryFilterState>(INITIAL_FILTERS);

  useEffect(() => {
    log('[DEBUG] Initializing gallery filters with', assets.length, 'assets');
  }, [assets.length]);

  const filteredAssets = useMemo(() => {
    const startTime = performance.now();
    const result = applyGalleryFilters(assets, filters);
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    log(`Filtered ${assets.length} assets → ${result.length} results in ${duration}ms`, {
      filters: {
        query: filters.query,
        sort: filters.sort
      }
    });
    
    return result;
  }, [assets, filters]);

  const setQuery = (query: string) => {
    log('Setting query:', query);
    setFilters((current) => ({ ...current, query }));
  };
  
  const setSort = (sort: GalleryFilterState["sort"]) => {
    log('Setting sort:', sort);
    setFilters((current) => ({ ...current, sort }));
  };

  return {
    filters,
    filteredAssets,
    setQuery,
    setSort
  };
}
