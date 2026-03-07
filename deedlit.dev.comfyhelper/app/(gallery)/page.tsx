"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import GalleryImageGrid from "./components/GalleryImageGrid";
import GalleryActiveFiltersBar from "./components/GalleryActiveFiltersBar";
import GalleryControlsDock from "./components/GalleryControlsDock";
import GalleryFiltersDock, { type GalleryFiltersTab } from "./components/GalleryFiltersDock";
import GalleryUnifiedDock, { type UnifiedDockTab } from "./components/GalleryUnifiedDock";
import {
  useCollections,
  useGalleryFilters,
  useGalleryGrid,
  useGalleryLibrary,
  useImageModal,
  useTagFilterPresets,
  useWorkflowViewer,
} from "./hooks";
import {
  InfoChip,
  Modal,
  OutlineButton,
  PageHeader,
  ScanProgress,
  SegmentedControl,
  SelectInput,
  TextInput,
  WarningList,
} from "@deedlit.dev/ui";
import { toFriendlyDate } from "@/lib/format-utils";

import type { TagFilterPreset } from "@/lib/library-types";

const GalleryTagFiltersPanel = dynamic(() => import("./components/GalleryTagFiltersPanel"));
const GalleryPathFilterPanel = dynamic(() => import("./components/GalleryPathFilterPanel"));
const GalleryTagPresetPanel = dynamic(() => import("./components/GalleryTagPresetPanel"));
const ImageDetailsModal = dynamic(() => import("./components/ImageDetailsModal"));
const GalleryCollectionsDock = dynamic(() => import("./components/GalleryCollectionsDock"));

const COLLECTION_PREVIEW_QUALITY = 95;

function HomeContent() {
  const [hasMounted, setHasMounted] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // 1) Library data & scan management
  const library = useGalleryLibrary();

  // Collections (favourites & groups)
  const collections = useCollections();
  const [isCollectionsDockOpen, setIsCollectionsDockOpen] = useState(false);

  // 2) Lifted preset id state (resolves circular dependency)
  const [activeTagFilterPresetId, setActiveTagFilterPresetId] = useState<string>("none");
  const [activeFiltersTab, setActiveFiltersTab] = useState<GalleryFiltersTab>("tag-filter-panel");
  const [isFiltersDockOpen, setIsFiltersDockOpen] = useState(false);

  // Unified mobile dock state
  const [isUnifiedDockOpen, setIsUnifiedDockOpen] = useState(false);
  const [unifiedDockTab, setUnifiedDockTab] = useState<UnifiedDockTab>("controls");

  // Controls dock state with localStorage persistence
  const [isControlsDockOpen, setIsControlsDockOpen] = useState(false);

  // Load initial state from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem("galleryControlsDockOpen");
    setIsControlsDockOpen(saved !== null ? saved === "true" : true);
  }, []);

  // Save controls dock state to localStorage
  useEffect(() => {
    localStorage.setItem("galleryControlsDockOpen", String(isControlsDockOpen));
  }, [isControlsDockOpen]);

  const activeTagFilterPreset: TagFilterPreset | null =
    activeTagFilterPresetId === "none"
      ? null
      : library.tagFilterPresets.find((preset) => preset.id === activeTagFilterPresetId) ?? null;

  // 3) Gallery filters (images, path tree, tags, models)
  const filters = useGalleryFilters(
    library.images,
    library.roots,
    library.excludedTags,
    activeTagFilterPreset,
  );

  // 4) Tag filter presets
  const presets = useTagFilterPresets(
    library.tagFilterPresets,
    filters.selectedPositiveTags,
    filters.selectedNegativeTags,
    library.saveTagFilterPresets,
    library.setErrorMessage,
    activeTagFilterPresetId,
    setActiveTagFilterPresetId,
  );

  // 5) Image modal (selection, navigation, slideshow)
  const modal = useImageModal(filters.filteredImages, filters.detailsById);

  // Auto-open image modal from ?imageId= search param (used by notes linking)
  const imageIdParam = searchParams.get("imageId");
  const handledImageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!imageIdParam || imageIdParam === handledImageIdRef.current) return;
    if (!library.images || library.images.length === 0) return;

    const targetImage = library.images.find((img) => img.id === imageIdParam);
    if (targetImage) {
      modal.setSelectedImage(targetImage);
      handledImageIdRef.current = imageIdParam;
      router.replace("/", { scroll: false });
    }
  }, [imageIdParam, library.images, modal.setSelectedImage, router]);

  // 6) Workflow viewer (canvas, pan/zoom)
  const workflow = useWorkflowViewer(
    modal.selectedWorkflowDetails,
    modal.selectedModalTab,
    modal.selectedImage?.id,
  );

  // 7) Gallery grid layout & infinite scroll
  const grid = useGalleryGrid(
    library.galleryColumns,
    !library.isLoading && filters.filteredImages.length > 0,
    filters.canShowMoreImages,
    filters.canShowPreviousImages,
    filters.windowStart,
    filters.slideWindowDown,
    filters.slideWindowUp,
  );

  const {
    roots,
    images,
    warnings,
    scannedAt,
    totalImages,
    isLibraryTruncated,
    appliedImageLimit,
    isLoading,
    isStartingScan,
    isSavingTagPreset,
    isDeletingImage,
    isScanActive,
    scanJob,
    scanFeedback,
    scanProgressPercent,
    errorMessage,
    handleStartScan,
    handleRecheckExtraction,
    handleDeleteImage,
    handleDeleteImages,
  } = library;

  const {
    selectedRootId,
    setSelectedRootId,
    searchTerm,
    setSearchTerm,
    selectedPathNode,
    setSelectedPathNode,
    selectedPositiveTags,
    setSelectedPositiveTags,
    selectedNegativeTags,
    setSelectedNegativeTags,
    selectedModels,
    setSelectedModels,
    tagLogicalMode,
    setTagLogicalMode,
    sortOrder,
    setSortOrder,
    showOnlyUntagged,
    setShowOnlyUntagged,
    filteredImages,
    visibleImages,
    visibleImageCount,
    windowStart,
    canShowMoreImages,
    canShowPreviousImages,
    deepestPathTreeNodes,
    deepestSelectedPath,
    positiveTagCounts,
    negativeTagCounts,
    modelCounts,
    toggleTagSelection,
    showMoreImages,
  } = filters;

  const {
    newTagPresetName,
    setNewTagPresetName,
    presetPositiveTagDraft,
    setPresetPositiveTagDraft,
    presetNegativeTagDraft,
    setPresetNegativeTagDraft,
    isDeletingTagPresetId,
    createTagFilterPreset,
    deleteTagFilterPreset,
    addTagToActivePreset,
    updateActivePresetFromSelectedFilters,
  } = presets;

  const { galleryGridRef, loadMoreSentinelRef, loadPreviousSentinelRef, topSpacerHeight, effectiveGalleryColumns, galleryGridStyle } = grid;
  const totalSelectedTagCount = selectedPositiveTags.length + selectedNegativeTags.length;
  const totalActiveFilterCount = totalSelectedTagCount + selectedModels.length;
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const selectableImageIdSet = useMemo(() => new Set(filteredImages.map((image) => image.id)), [filteredImages]);
  const selectedImageIdsInView = useMemo(() => {
    const ids: string[] = [];
    for (const imageId of selectedImageIds) {
      if (selectableImageIdSet.has(imageId)) {
        ids.push(imageId);
      }
    }
    return ids;
  }, [selectedImageIds, selectableImageIdSet]);
  const selectedImageIdSet = useMemo(() => new Set(selectedImageIdsInView), [selectedImageIdsInView]);
  const selectedImages = useMemo(
    () => filteredImages.filter((image) => selectedImageIdSet.has(image.id)),
    [filteredImages, selectedImageIdSet],
  );
  const selectedImageCount = selectedImageIdsInView.length;

  const selectVisibleImages = () => {
    setSelectedImageIds((current) => {
      const next = new Set(current);
      for (const image of visibleImages) {
        next.add(image.id);
      }
      return next;
    });
  };

  const selectAllFilteredImages = () => {
    setSelectedImageIds(new Set(filteredImages.map((image) => image.id)));
  };

  const clearSelectedImages = () => {
    setSelectedImageIds(new Set());
  };

  const toggleImageSelection = useCallback((imageId: string, isSelected: boolean) => {
    setSelectedImageIds((current) => {
      const exists = current.has(imageId);
      if (exists === isSelected) {
        return current;
      }
      const next = new Set(current);
      if (isSelected) {
        next.add(imageId);
      } else {
        next.delete(imageId);
      }
      return next;
    });
  }, []);

  const handleBulkDeleteSelectedImages = async () => {
    if (selectedImages.length === 0) return;
    setIsBulkDeleteConfirmOpen(true);
  };

  const handleDeleteKeyPressed = useCallback(
    (activeImageId: string | null) => {
      if (isDeletingImage) return;
      if (selectedImageCount > 0) {
        setIsBulkDeleteConfirmOpen(true);
        return;
      }
      if (!activeImageId) return;
      setSelectedImageIds(new Set([activeImageId]));
      setIsBulkDeleteConfirmOpen(true);
    },
    [isDeletingImage, selectedImageCount],
  );

  const confirmBulkDeleteSelectedImages = async () => {
    if (selectedImages.length === 0) {
      setIsBulkDeleteConfirmOpen(false);
      return;
    }
    setIsBulkDeleteConfirmOpen(false);

    const result = await handleDeleteImages(selectedImages);
    if (result.movedPaths.length === 0) {
      return;
    }

    const movedPathSet = new Set(result.movedPaths);
    setSelectedImageIds((current) => {
      const next = new Set(current);
      for (const image of selectedImages) {
        if (movedPathSet.has(image.absolutePath)) {
          next.delete(image.id);
        }
      }
      return next;
    });
  };

  // Handle clicking an image from the collections dock
  const handleCollectionImageClick = useCallback(
    (imageId: string) => {
      const targetImage = library.images.find((img) => img.id === imageId);
      if (targetImage) {
        modal.setSelectedImage(targetImage);
      }
    },
    [library.images, modal.setSelectedImage],
  );

  return (
    <>
      <section
        id="gallery-page"
        data-testid="gallery-page"
        className="cyber-panel rounded-[20px] p-2 sm:rounded-[28px] sm:p-5 xl:p-6"
      >
        <PageHeader
          testId="gallery-header"
          subtitle="deedlit.dev // gallery"
          title="Image Results"
          titleTag="h2"
          description="Browse, filter, and inspect generated images with metadata."
          className="mb-5"
        />

        {errorMessage && (
          <p
            id="gallery-error-message"
            data-testid="gallery-error-message"
            role="alert"
            className="mt-4 rounded-xl border border-error-edge bg-error px-3 py-2 text-ui-sm text-error-ink"
          >
            {errorMessage}
          </p>
        )}

        <WarningList
          warnings={warnings}
          testId="gallery-warning-list"
          entryTestId="gallery-warning-entry"
          className="mt-4"
        />

        {isLibraryTruncated && (
          <p className="mt-4 rounded-xl border border-ui-border bg-ui-bg px-3 py-2 text-ui-sm text-ui-ink-muted">
            Loaded {images.length} of {totalImages} cached images to keep the UI responsive
            {appliedImageLimit ? ` (limit: ${appliedImageLimit})` : ""}.
          </p>
        )}

        {hasMounted && scanFeedback && (
          <p className="mt-4 rounded-xl border border-ui-border bg-panel/80 px-3 py-2 text-ui-sm text-ui-ink-muted">
            {scanFeedback}
          </p>
        )}

        {hasMounted && (isLoading || isScanActive) && (
          <ScanProgress
            rootCount={roots.length}
            title={isScanActive ? "Background scan in progress" : "Scanning configured roots"}
            progressPercent={isScanActive ? scanProgressPercent : undefined}
            processedCount={isScanActive ? scanJob?.processedFiles : undefined}
            totalCount={isScanActive ? scanJob?.totalFiles : undefined}
            statusLabel={isScanActive ? `${scanJob?.status ?? "running"} scan` : undefined}
            className="mt-6"
          />
        )}

        <div className="mt-6 min-w-0">
          {filteredImages.length > 0 && (
            <div className="hidden md:block rounded-2xl border border-ui-border bg-ui-bg-card p-2 sm:p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="text-ui-xs text-ui-ink-muted sm:text-ui-sm">
                  Selected: <span className="font-semibold text-ui-ink-title">{selectedImageCount}</span>{" "}
                  image{selectedImageCount === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <OutlineButton
                    onClick={selectVisibleImages}
                    className="rounded-xl px-2 py-1.5 text-ui-xs sm:px-3 sm:py-2 sm:text-ui-sm"
                  >
                    Select visible
                  </OutlineButton>
                  <OutlineButton
                    onClick={selectAllFilteredImages}
                    className="rounded-xl px-2 py-1.5 text-ui-xs sm:px-3 sm:py-2 sm:text-ui-sm"
                  >
                    Select all
                  </OutlineButton>
                  <OutlineButton
                    onClick={clearSelectedImages}
                    disabled={selectedImageCount === 0}
                    className="rounded-xl px-2 py-1.5 text-ui-xs sm:px-3 sm:py-2 sm:text-ui-sm"
                  >
                    Clear
                  </OutlineButton>
                  <OutlineButton
                    onClick={() => void handleBulkDeleteSelectedImages()}
                    disabled={selectedImageCount === 0 || isDeletingImage}
                    className="rounded-xl px-2 py-1.5 text-ui-xs sm:px-3 sm:py-2 sm:text-ui-sm"
                  >
                    {isDeletingImage ? "Moving..." : "Move to trash"}
                  </OutlineButton>
                </div>
              </div>
            </div>
          )}

          <GalleryImageGrid
            isLoading={isLoading}
            isScanActive={isScanActive}
            filteredImages={filteredImages}
            visibleImages={visibleImages}
            visibleImageCount={visibleImageCount}
            windowStart={windowStart}
            galleryColumns={effectiveGalleryColumns}
            canShowMoreImages={canShowMoreImages}
            canShowPreviousImages={canShowPreviousImages}
            galleryGridRef={galleryGridRef}
            loadMoreSentinelRef={loadMoreSentinelRef}
            loadPreviousSentinelRef={loadPreviousSentinelRef}
            topSpacerHeight={topSpacerHeight}
            galleryGridStyle={galleryGridStyle}
            selectedImageIds={selectedImageIdSet}
            onToggleImageSelection={toggleImageSelection}
            onSelectImage={modal.setSelectedImage}
            onDeleteKeyPressed={handleDeleteKeyPressed}
            onShowMoreImages={showMoreImages}
            isImageDetailsModalOpen={Boolean(modal.selectedImage)}
            collections={collections}
          />
        </div>
      </section>

      {/* Desktop-only: separate docks */}
      <div className="hidden md:block">
        <GalleryControlsDock
          isOpen={isControlsDockOpen}
          onOpenChange={setIsControlsDockOpen}
          roots={roots}
          imagesCount={images.length}
          totalImages={totalImages}
          scannedAtLabel={scannedAt ? `Last scan: ${toFriendlyDate(scannedAt)}` : "No scan yet"}
          selectedRootId={selectedRootId}
          searchTerm={searchTerm}
          onRootChange={setSelectedRootId}
          onSearchTermChange={setSearchTerm}
          isLoading={isLoading}
          isStartingScan={isStartingScan}
          isScanActive={isScanActive}
          onRescan={() => void handleStartScan()}
          onRecheckExtraction={() => void handleRecheckExtraction()}
          onClearFilters={() => {
            filters.clearAllFilters();
            setActiveTagFilterPresetId("none");
          }}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          showOnlyUntagged={showOnlyUntagged}
          onShowOnlyUntaggedChange={setShowOnlyUntagged}
        />

        <GalleryFiltersDock
          isOpen={isFiltersDockOpen}
          activeFilterCount={totalActiveFilterCount}
          activeTab={activeFiltersTab}
          onOpenChange={setIsFiltersDockOpen}
          onActiveTabChange={setActiveFiltersTab}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <GalleryActiveFiltersBar
              isNested
              selectedPositiveTags={selectedPositiveTags}
              selectedNegativeTags={selectedNegativeTags}
              selectedModels={selectedModels}
              tagLogicalMode={tagLogicalMode}
              onTagLogicalModeChange={setTagLogicalMode}
              onResetFilters={() => {
                setSelectedPositiveTags([]);
                setSelectedNegativeTags([]);
                setSelectedModels([]);
                setTagLogicalMode("and");
              }}
              onTogglePositiveTag={(tag) => toggleTagSelection(tag, setSelectedPositiveTags)}
              onToggleNegativeTag={(tag) => toggleTagSelection(tag, setSelectedNegativeTags)}
              onToggleModelTag={(tag) => toggleTagSelection(tag, setSelectedModels)}
            />

            <div className="custom-scrollbar mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
              {activeFiltersTab === "tag-filter-panel" && (
                <GalleryTagFiltersPanel
                  selectedPositiveTags={selectedPositiveTags}
                  selectedNegativeTags={selectedNegativeTags}
                  selectedModels={selectedModels}
                  positiveTagCounts={positiveTagCounts}
                  negativeTagCounts={negativeTagCounts}
                  modelCounts={modelCounts}
                  onTogglePositiveTag={(tag) => toggleTagSelection(tag, setSelectedPositiveTags)}
                  onToggleNegativeTag={(tag) => toggleTagSelection(tag, setSelectedNegativeTags)}
                  onToggleModel={(tag) => toggleTagSelection(tag, setSelectedModels)}
                  isNested
                />
              )}

              {activeFiltersTab === "path-tree-filter" && (
                <GalleryPathFilterPanel
                  selectedPathNode={selectedPathNode}
                  deepestSelectedPath={deepestSelectedPath}
                  deepestPathTreeNodes={deepestPathTreeNodes}
                  onSelectPathNode={setSelectedPathNode}
                  isNested
                />
              )}

              {activeFiltersTab === "tag-preset-panel" && (
                <GalleryTagPresetPanel
                  tagFilterPresets={library.tagFilterPresets}
                  activeTagFilterPreset={activeTagFilterPreset}
                  activeTagFilterPresetId={activeTagFilterPresetId}
                  onActiveTagFilterPresetIdChange={setActiveTagFilterPresetId}
                  isSavingTagPreset={isSavingTagPreset}
                  isDeletingTagPresetId={isDeletingTagPresetId}
                  presetPositiveTagDraft={presetPositiveTagDraft}
                  onPresetPositiveTagDraftChange={setPresetPositiveTagDraft}
                  presetNegativeTagDraft={presetNegativeTagDraft}
                  onPresetNegativeTagDraftChange={setPresetNegativeTagDraft}
                  newTagPresetName={newTagPresetName}
                  onNewTagPresetNameChange={setNewTagPresetName}
                  selectedPositiveTagCount={selectedPositiveTags.length}
                  selectedNegativeTagCount={selectedNegativeTags.length}
                  onAddTagToActivePreset={(kind) => void addTagToActivePreset(kind)}
                  onUpdateActivePresetFromSelectedFilters={() => void updateActivePresetFromSelectedFilters()}
                  onCreateTagFilterPreset={() => void createTagFilterPreset()}
                  onDeleteTagFilterPreset={(presetId) => void deleteTagFilterPreset(presetId)}
                  isNested
                />
              )}
            </div>
          </div>
        </GalleryFiltersDock>

        <GalleryCollectionsDock
          isOpen={isCollectionsDockOpen}
          onOpenChange={setIsCollectionsDockOpen}
          collections={collections}
          onImageClick={handleCollectionImageClick}
        />
      </div>

      {/* Mobile-only: unified dock */}
      <GalleryUnifiedDock
        isOpen={isUnifiedDockOpen}
        onOpenChange={setIsUnifiedDockOpen}
        activeTab={unifiedDockTab}
        onActiveTabChange={setUnifiedDockTab}
        badgeCount={totalActiveFilterCount + (selectedRootId !== "all" ? 1 : 0) + (searchTerm.trim() !== "" ? 1 : 0) + (sortOrder !== "none" ? 1 : 0) + (showOnlyUntagged ? 1 : 0)}
      >
        {unifiedDockTab === "controls" && (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                <span aria-hidden="true">📚</span>
                <span>Library Info</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                <InfoChip className="shrink-0">Roots: {roots.length}</InfoChip>
                <InfoChip className="shrink-0">
                  Images: {images.length}
                  {totalImages > images.length ? ` / ${totalImages}` : ""}
                </InfoChip>
                <InfoChip className="shrink-0">
                  {scannedAt ? `Last scan: ${toFriendlyDate(scannedAt)}` : "No scan yet"}
                </InfoChip>
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                <span aria-hidden="true">🔍</span>
                <span>Search & Filter</span>
              </h3>
              <div className="space-y-2">
                <SelectInput
                  id="gallery-root-filter-unified"
                  name="selectedRoot"
                  value={selectedRootId}
                  onChange={(event) => setSelectedRootId(event.target.value)}
                  className="min-h-10 w-full"
                >
                  <option value="all">All roots</option>
                  {roots.map((root) => (
                    <option key={root.id} value={root.id} title={root.path}>
                      {root.path}
                    </option>
                  ))}
                </SelectInput>
                <TextInput
                  id="gallery-search-input-unified"
                  name="fileNameSearch"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="File name contains"
                  className="min-h-10 w-full"
                />
                <SelectInput
                  id="gallery-sort-order-unified"
                  name="sortOrder"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest" | "none")}
                  className="min-h-10 w-full"
                >
                  <option value="none">No sorting</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </SelectInput>
                <OutlineButton
                  onClick={() => setShowOnlyUntagged(!showOnlyUntagged)}
                  variant={showOnlyUntagged ? "accent" : "ghost"}
                  controlSize="lg"
                  className="w-full"
                >
                  {showOnlyUntagged ? "✓ " : ""}Show only untagged images
                </OutlineButton>
              </div>
            </section>

            {filteredImages.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                  <span aria-hidden="true">✓</span>
                  <span>Selection</span>
                </h3>
                <div className="mb-3 rounded-lg border border-ui-border bg-ui-bg-card p-2">
                  <p className="text-ui-sm text-ui-ink-muted">
                    Selected: <span className="font-semibold text-ui-ink-title">{selectedImageCount}</span>{" "}
                    image{selectedImageCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <OutlineButton
                    onClick={selectVisibleImages}
                    variant="ghost"
                    controlSize="lg"
                  >
                    Select visible
                  </OutlineButton>
                  <OutlineButton
                    onClick={selectAllFilteredImages}
                    variant="ghost"
                    controlSize="lg"
                  >
                    Select all
                  </OutlineButton>
                  <OutlineButton
                    onClick={clearSelectedImages}
                    disabled={selectedImageCount === 0}
                    variant="ghost"
                    controlSize="lg"
                  >
                    Clear
                  </OutlineButton>
                  <OutlineButton
                    onClick={() => void handleBulkDeleteSelectedImages()}
                    disabled={selectedImageCount === 0 || isDeletingImage}
                    variant="ghost"
                    controlSize="lg"
                    className="col-span-2"
                  >
                    {isDeletingImage ? "Moving..." : "Move to trash"}
                  </OutlineButton>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                <span aria-hidden="true">⚙️</span>
                <span>Library Actions</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <OutlineButton
                  onClick={() => void handleStartScan()}
                  disabled={isLoading || isStartingScan || isScanActive}
                  variant="ghost"
                  controlSize="lg"
                >
                  {isStartingScan ? "Starting..." : isScanActive ? "Scanning..." : "Rescan"}
                </OutlineButton>
                <OutlineButton
                  onClick={() => void handleRecheckExtraction()}
                  disabled={isLoading || isStartingScan || isScanActive}
                  variant="ghost"
                  controlSize="lg"
                >
                  Recheck metadata
                </OutlineButton>
                <OutlineButton
                  onClick={() => {
                    filters.clearAllFilters();
                    setActiveTagFilterPresetId("none");
                  }}
                  variant="ghost"
                  controlSize="lg"
                >
                  Clear filters
                </OutlineButton>
              </div>
            </section>
          </div>
        )}

        {unifiedDockTab === "filters" && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <GalleryActiveFiltersBar
              isNested
              selectedPositiveTags={selectedPositiveTags}
              selectedNegativeTags={selectedNegativeTags}
              selectedModels={selectedModels}
              tagLogicalMode={tagLogicalMode}
              onTagLogicalModeChange={setTagLogicalMode}
              onResetFilters={() => {
                setSelectedPositiveTags([]);
                setSelectedNegativeTags([]);
                setSelectedModels([]);
                setTagLogicalMode("and");
              }}
              onTogglePositiveTag={(tag) => toggleTagSelection(tag, setSelectedPositiveTags)}
              onToggleNegativeTag={(tag) => toggleTagSelection(tag, setSelectedNegativeTags)}
              onToggleModelTag={(tag) => toggleTagSelection(tag, setSelectedModels)}
            />

            <div className="mt-2">
              <SegmentedControl
                value={activeFiltersTab}
                onValueChange={setActiveFiltersTab}
                className="grid w-full grid-cols-3 rounded-xl border border-ui-border-soft bg-panel/70 p-1"
                optionClassName="rounded-lg px-2 py-1 text-ui-xs"
                options={[
                  { value: "tag-filter-panel", label: "Tags" },
                  { value: "path-tree-filter", label: "Path Tree" },
                  { value: "tag-preset-panel", label: "Presets" },
                ]}
              />
            </div>

            <div className="custom-scrollbar mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
              {activeFiltersTab === "tag-filter-panel" && (
                <GalleryTagFiltersPanel
                  selectedPositiveTags={selectedPositiveTags}
                  selectedNegativeTags={selectedNegativeTags}
                  selectedModels={selectedModels}
                  positiveTagCounts={positiveTagCounts}
                  negativeTagCounts={negativeTagCounts}
                  modelCounts={modelCounts}
                  onTogglePositiveTag={(tag) => toggleTagSelection(tag, setSelectedPositiveTags)}
                  onToggleNegativeTag={(tag) => toggleTagSelection(tag, setSelectedNegativeTags)}
                  onToggleModel={(tag) => toggleTagSelection(tag, setSelectedModels)}
                  isNested
                />
              )}

              {activeFiltersTab === "path-tree-filter" && (
                <GalleryPathFilterPanel
                  selectedPathNode={selectedPathNode}
                  deepestSelectedPath={deepestSelectedPath}
                  deepestPathTreeNodes={deepestPathTreeNodes}
                  onSelectPathNode={setSelectedPathNode}
                  isNested
                />
              )}

              {activeFiltersTab === "tag-preset-panel" && (
                <GalleryTagPresetPanel
                  tagFilterPresets={library.tagFilterPresets}
                  activeTagFilterPreset={activeTagFilterPreset}
                  activeTagFilterPresetId={activeTagFilterPresetId}
                  onActiveTagFilterPresetIdChange={setActiveTagFilterPresetId}
                  isSavingTagPreset={isSavingTagPreset}
                  isDeletingTagPresetId={isDeletingTagPresetId}
                  presetPositiveTagDraft={presetPositiveTagDraft}
                  onPresetPositiveTagDraftChange={setPresetPositiveTagDraft}
                  presetNegativeTagDraft={presetNegativeTagDraft}
                  onPresetNegativeTagDraftChange={setPresetNegativeTagDraft}
                  newTagPresetName={newTagPresetName}
                  onNewTagPresetNameChange={setNewTagPresetName}
                  selectedPositiveTagCount={selectedPositiveTags.length}
                  selectedNegativeTagCount={selectedNegativeTags.length}
                  onAddTagToActivePreset={(kind) => void addTagToActivePreset(kind)}
                  onUpdateActivePresetFromSelectedFilters={() => void updateActivePresetFromSelectedFilters()}
                  onCreateTagFilterPreset={() => void createTagFilterPreset()}
                  onDeleteTagFilterPreset={(presetId) => void deleteTagFilterPreset(presetId)}
                  isNested
                />
              )}
            </div>
          </div>
        )}

        {unifiedDockTab === "collections" && (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                <span aria-hidden="true">❤️</span>
                <span>Favourites ({collections.favourites.length})</span>
              </h3>
              {collections.favourites.length === 0 ? (
                <p className="py-2 text-center text-ui-xs text-ui-ink-note">
                  No favourites yet. Click the heart icon on any image.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {collections.favourites.slice(0, 12).map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => handleCollectionImageClick(img.id)}
                      className="relative aspect-square overflow-hidden rounded-lg border border-ui-border bg-ui-bg-table"
                      title={img.fileName}
                    >
                      <Image src={img.url} alt={img.fileName} fill className="object-contain" sizes="80px" quality={COLLECTION_PREVIEW_QUALITY} />
                    </button>
                  ))}
                  {collections.favourites.length > 12 && (
                    <p className="col-span-4 text-center text-ui-2xs text-ui-ink-note">
                      +{collections.favourites.length - 12} more — open collections dock on desktop to see all
                    </p>
                  )}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-ui-ink-caption">
                <span aria-hidden="true">📁</span>
                <span>Groups ({collections.groups.length})</span>
              </h3>
              {collections.groups.length === 0 ? (
                <p className="py-2 text-center text-ui-xs text-ui-ink-note">
                  No groups yet. Open collections dock on desktop to create groups.
                </p>
              ) : (
                <div className="space-y-2">
                  {collections.groups.map((group) => (
                    <div key={group.id} className="rounded-xl border border-ui-border bg-ui-bg-card p-2">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: group.colour }} aria-hidden="true" />
                        <span className="text-ui-sm font-medium text-ui-ink-title">{group.name}</span>
                        <span className="text-ui-2xs text-ui-ink-note">{group.images.length} images</span>
                      </div>
                      {group.images.length > 0 && (
                        <div className="mt-1.5 grid grid-cols-4 gap-1">
                          {group.images.slice(0, 4).map((img) => (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => handleCollectionImageClick(img.id)}
                              className="relative aspect-square overflow-hidden rounded-md border border-ui-border bg-ui-bg-table"
                              title={img.fileName}
                            >
                              <Image src={img.url} alt={img.fileName} fill className="object-contain" sizes="80px" quality={COLLECTION_PREVIEW_QUALITY} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </GalleryUnifiedDock>

      <ImageDetailsModal
        modal={modal}
        workflow={workflow}
        filteredImages={filteredImages}
        isDeletingImage={isDeletingImage}
        handleDeleteImage={handleDeleteImage}
        collections={collections}
      />

      <Modal
        open={isBulkDeleteConfirmOpen}
        onClose={() => setIsBulkDeleteConfirmOpen(false)}
        title="Move Selected Images To Trash"
        description={`Move ${selectedImageCount} selected image${selectedImageCount === 1 ? "" : "s"} to trash?`}
        closeLabel="Close delete confirmation"

        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <OutlineButton
              type="button"
              onClick={() => setIsBulkDeleteConfirmOpen(false)}
              disabled={isDeletingImage}
            >
              Cancel
            </OutlineButton>
            <OutlineButton
              type="button"
              variant="danger"
              onClick={() => void confirmBulkDeleteSelectedImages()}
              disabled={isDeletingImage}
            >
              {isDeletingImage ? "Moving..." : "Move To Trash"}
            </OutlineButton>
          </div>
        }
      >
        <p className="text-ui-sm text-ui-ink-subtle">
          This only moves cached files to your configured trash location. No permanent delete is performed.
        </p>
      </Modal>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

