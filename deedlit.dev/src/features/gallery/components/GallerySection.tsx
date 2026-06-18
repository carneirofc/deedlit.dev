"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Gallery } from "@deedlit.dev/ui";
import { GalleryFilters } from "@/features/gallery/components/GalleryFilters";
import { ImageModal } from "@/features/gallery/components/ImageModal";
import { useGalleryFilters } from "@/features/gallery/hooks/useGalleryFilters";
import { isTextInputTarget } from "@/features/gallery/lib/filtering";
import type { GalleryStats, ImageAsset } from "@/features/gallery/types";

interface GallerySectionProps {
  assets: ImageAsset[];
  tags?: string[];
  stats?: GalleryStats;
}

interface GalleryApiResponse {
  assets: ImageAsset[];
}

// Memoized so opening the modal / typing in search / the refresh poll
// re-renders GallerySection without re-rendering (and re-decoding) every
// thumbnail. Props are primitive strings, so React.memo bails on equality.
const GalleryCard = memo(function GalleryCard({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="relative aspect-[3/4]">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>
    </div>
  );
});

function hasAssetListChanged(current: ImageAsset[], next: ImageAsset[]) {
  if (current.length !== next.length) return true;
  for (let index = 0; index < current.length; index += 1) {
    if (
      current[index]?.id !== next[index]?.id ||
      current[index]?.createdAt !== next[index]?.createdAt
    ) {
      return true;
    }
  }
  return false;
}

export function GallerySection({ assets }: GallerySectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const [liveAssets, setLiveAssets] = useState<ImageAsset[]>(assets);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const { filters, filteredAssets, setQuery, setSort } = useGalleryFilters(liveAssets);

  useEffect(() => {
    setLiveAssets(assets);
  }, [assets]);

  const refreshAssets = useCallback(async () => {
    try {
      const response = await fetch("/api/gallery", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as GalleryApiResponse;
      if (!payload.assets) return;
      setLiveAssets((current) => (hasAssetListChanged(current, payload.assets) ? payload.assets : current));
    } catch {
      // Ignore transient errors and keep current list.
    }
  }, []);

  useEffect(() => {
    // Poll only while the tab is visible, and refresh once on return to it.
    // Single trigger avoids the focus + visibilitychange double-fire.
    const maybeRefresh = () => {
      if (document.visibilityState === "visible") {
        void refreshAssets();
      }
    };

    const intervalId = window.setInterval(maybeRefresh, 30000);
    document.addEventListener("visibilitychange", maybeRefresh);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [refreshAssets]);

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const imageId = params.get("image");
      if (!imageId) {
        setModalIndex(null);
        return;
      }
      const index = filteredAssets.findIndex((asset) => asset.id === imageId);
      if (index >= 0) {
        setModalIndex(index);
      }
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [filteredAssets]);

  useEffect(() => {
    if (modalIndex === null) return;
    if (filteredAssets.length === 0) {
      setModalIndex(null);
      return;
    }
    if (modalIndex > filteredAssets.length - 1) {
      setModalIndex(filteredAssets.length - 1);
    }
  }, [filteredAssets, modalIndex]);

  const closeModal = useCallback(() => {
    setModalIndex(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("image");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);
  const openModal = useCallback(
    (index: number) => {
      setModalIndex(index);
      const asset = filteredAssets[index];
      if (!asset) return;
      const params = new URLSearchParams(window.location.search);
      params.set("image", asset.id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [filteredAssets, pathname, router]
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTextInputTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (modalIndex === null) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, modalIndex]);

  const activeAsset = modalIndex !== null ? filteredAssets[modalIndex] ?? null : null;
  return (
    <section id="gallery" className="section-anchor mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Gallery</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Image archive</h2>
          <p className="text-xs text-muted">Press `/` to search</p>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Browse generated images and open them in the viewer.
        </p>
      </div>

      <GalleryFilters
        query={filters.query}
        onQueryChange={setQuery}
        sort={filters.sort}
        onSortChange={setSort}
        searchRef={searchRef}
        filteredCount={filteredAssets.length}
        totalCount={liveAssets.length}
      />

      {filteredAssets.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-line/80 bg-surface/70 p-10 text-center text-sm text-muted">
          No matches.
        </div>
      ) : (
        <Gallery
          items={filteredAssets}
          getKey={(asset) => asset.id}
          viewMode="grid"
          gridClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          cardClassName="rounded-xl2 bg-surface/75 p-3 shadow-soft"
          mediaClassName="focus-ring w-full"
          onOpen={(index) => openModal(index)}
          renderMedia={(asset) => <GalleryCard src={asset.src} alt={asset.title} />}
          renderMeta={(asset) => (
            <div className="mt-3">
              <a
                href={asset.referenceHref}
                className="focus-ring text-sm font-medium text-muted transition hover:text-text"
              >
                {asset.title}
              </a>
            </div>
          )}
        />
      )}

      <ImageModal
        asset={activeAsset}
        isOpen={modalIndex !== null}
        onClose={closeModal}
      />
    </section>
  );
}
