"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CollapsiblePanel,
  DownloadIcon,
  MediaStage,
  MetadataTabBar,
  OutlineButton,
  XIcon,
  type MetadataTabValue,
} from "@deedlit.dev/ui";
import type { ImageRecord } from "@/lib/library-types";
import { useImageDetailQuery } from "@/lib/queries/use-image-detail";
import { useNotesByImageQuery } from "@/lib/queries/use-notes";
import { useWorkflowViewer } from "@/app/(gallery)/hooks/use-workflow-viewer";
import {
  DetailsTabContent,
  RawMetadataTabContent,
  WorkflowTabContent,
} from "@/app/(gallery)/components/modal";
import NoteReferencesSection from "@/app/(gallery)/components/modal/NoteReferencesSection";

type StandaloneImageModalProps = {
  image: ImageRecord | null;
  onClose: () => void;
};

export default function StandaloneImageModal({ image, onClose }: StandaloneImageModalProps) {
  const [selectedTab, setSelectedTab] = useState<MetadataTabValue>("details");
  const [copiedPrompt, setCopiedPrompt] = useState<"positive" | "negative" | null>(null);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);

  // Fetch full metadata
  const imageDetailQuery = useImageDetailQuery(image?.id ?? null);
  const imageWithMetadata =
    image && imageDetailQuery.data && imageDetailQuery.data.id === image.id
      ? imageDetailQuery.data
      : null;
  const isMetadataLoading = image ? imageDetailQuery.isLoading : false;
  const metadataError = image
    ? (imageDetailQuery.error instanceof Error ? imageDetailQuery.error.message : null)
    : null;

  const generationDetails = useMemo(() => {
    if (!image) return null;
    if (imageWithMetadata && imageWithMetadata.id === image.id) {
      return imageWithMetadata.generationDetails ?? null;
    }
    return image.generationDetails ?? null;
  }, [image, imageWithMetadata]);

  const workflowDetails = useMemo(() => {
    if (!imageWithMetadata) return null;
    return imageWithMetadata.workflowDetails ?? null;
  }, [imageWithMetadata]);

  const imageUrl = useMemo(() => {
    if (!image) return "";
    return `/api/image?path=${encodeURIComponent(image.absolutePath)}`;
  }, [image]);

  const imageForModal = useMemo(() => {
    if (!image) return null;
    if (imageWithMetadata && imageWithMetadata.id === image.id) {
      return imageWithMetadata;
    }
    return image;
  }, [image, imageWithMetadata]);

  // Workflow viewer
  const workflow = useWorkflowViewer(workflowDetails, selectedTab, image?.id);

  // Note references (data fetched here, passed as props to presentational component)
  const { data: noteReferences } = useNotesByImageQuery(image?.id ?? "");

  // Reset state when image changes
  useEffect(() => {
    setCopiedPrompt(null);
    setSelectedTab("details");
    setIsMobileDetailsOpen(false);
  }, [image?.id]);

  // Prompt copy
  const handlePromptCopy = useCallback(async (kind: "positive" | "negative", value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedPrompt(kind);
      window.setTimeout(() => {
        setCopiedPrompt((current) => (current === kind ? null : current));
      }, 1400);
    } catch {
      setCopiedPrompt(null);
    }
  }, []);

  // Body scroll lock
  useEffect(() => {
    if (!image) return;
    const htmlNode = document.documentElement;
    const bodyNode = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - htmlNode.clientWidth);
    const prevHtml = htmlNode.style.overflow;
    const prevBody = bodyNode.style.overflow;
    const prevOffset = htmlNode.style.getPropertyValue("--scroll-lock-offset");
    htmlNode.style.setProperty("--scroll-lock-offset", `${scrollbarWidth}px`);
    htmlNode.style.overflow = "hidden";
    bodyNode.style.overflow = "hidden";
    return () => {
      if (prevOffset) {
        htmlNode.style.setProperty("--scroll-lock-offset", prevOffset);
      } else {
        htmlNode.style.removeProperty("--scroll-lock-offset");
      }
      htmlNode.style.overflow = prevHtml;
      bodyNode.style.overflow = prevBody;
    };
  }, [image]);

  // Escape key
  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, onClose]);

  if (!image || !generationDetails) return null;
  if (typeof document === "undefined") return null;

  const isWorkflowTab = selectedTab === "workflow";
  const mobileTabLabel =
    selectedTab === "details"
      ? "Details"
      : selectedTab === "raw"
        ? "Raw Metadata"
        : "Workflow";

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = image.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--ui-overlay-strong)] p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[1700px] flex-col overflow-hidden rounded-2xl border border-[color:var(--ui-border-modal)] bg-[color:var(--ui-bg-card)] shadow-[var(--ui-shadow-strong)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Simplified header: filename, download, close */}
        <div className="flex items-center justify-between gap-2 border-b border-ui-border px-3 py-2 sm:px-5 sm:py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-ui-sm font-semibold text-(--ui-ink-primary) sm:text-ui-lg">
              {image.fileName}
            </h3>
            <p className="hidden max-w-[75vw] truncate text-ui-sm text-ui-ink-subtle sm:block">
              {image.relativePath}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <OutlineButton
              type="button"
              onClick={handleDownload}
              aria-label={`Download ${image.fileName}`}
              className="hidden p-1.5 sm:inline-flex"
            >
              <DownloadIcon size="h-5 w-5" />
            </OutlineButton>
            <OutlineButton
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5"
            >
              <XIcon size="h-5 w-5" />
            </OutlineButton>
          </div>
        </div>

        {/* Desktop layout: side-by-side grid */}
        <div
          className={`hidden min-h-0 flex-1 gap-0 lg:grid ${
            isWorkflowTab
              ? "grid-cols-1"
              : "lg:grid-cols-[minmax(0,0.85fr)_minmax(320px,1.15fr)]"
          }`}
        >
          <MediaStage hidden={isWorkflowTab} previousLabel="Previous image" nextLabel="Next image">
            <Image
              src={imageUrl}
              alt={image.fileName}
              fill
              sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, 100vw"
              quality={95}
              className="object-contain object-center"
            />
          </MediaStage>

          <div
            className={
              isWorkflowTab
                ? "min-h-0 overflow-hidden border-t border-[color:var(--ui-border)] p-3"
                : "min-h-0 overflow-auto border-l border-[color:var(--ui-border)] p-4"
            }
          >
            <div className={isWorkflowTab ? "flex h-full flex-col gap-3" : "space-y-3"}>
              <MetadataTabBar value={selectedTab} onValueChange={setSelectedTab} />

              {selectedTab === "details" ? (
                <DetailsTabContent
                  details={generationDetails}
                  isLoading={isMetadataLoading}
                  error={metadataError}
                  copiedPrompt={copiedPrompt}
                  onPromptCopy={handlePromptCopy}
                />
              ) : selectedTab === "raw" ? (
                <RawMetadataTabContent
                  metadataSource={generationDetails.metadataSource}
                  metadataPath={imageForModal?.metadataPath}
                  metadata={imageWithMetadata?.metadata ?? null}
                  isLoading={isMetadataLoading}
                  error={metadataError}
                />
              ) : (
                <WorkflowTabContent
                  isLoading={isMetadataLoading}
                  error={metadataError}
                  workflowDetails={workflowDetails}
                  workflow={workflow}
                />
              )}

              {selectedTab === "details" && (
                <NoteReferencesSection references={noteReferences} />
              )}
            </div>
          </div>
        </div>

        {/* Mobile layout: image on top, collapsible details below */}
        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <MediaStage hidden={false} previousLabel="Previous image" nextLabel="Next image" className="min-h-[40vh] flex-1">
            <Image
              src={imageUrl}
              alt={image.fileName}
              fill
              sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, 100vw"
              quality={95}
              className="object-contain object-center"
            />
          </MediaStage>

          <CollapsiblePanel
            label={mobileTabLabel}
            isOpen={isMobileDetailsOpen}
            onToggle={() => setIsMobileDetailsOpen((open) => !open)}
            className="border-t border-[color:var(--ui-border)]"
            triggerClassName="text-[color:var(--ui-ink-secondary)] hover:bg-[color:var(--ui-bg-soft)]"
            contentClassName={
              isWorkflowTab
                ? "max-h-[50vh] min-h-[200px] overflow-hidden border-t border-[color:var(--ui-border)] p-3"
                : "max-h-[50vh] overflow-auto border-t border-[color:var(--ui-border)] p-4"
            }
          >
            <div className={isWorkflowTab ? "flex h-full flex-col gap-3" : "space-y-3"}>
              <MetadataTabBar value={selectedTab} onValueChange={setSelectedTab} />

              {selectedTab === "details" ? (
                <DetailsTabContent
                  details={generationDetails}
                  isLoading={isMetadataLoading}
                  error={metadataError}
                  copiedPrompt={copiedPrompt}
                  onPromptCopy={handlePromptCopy}
                />
              ) : selectedTab === "raw" ? (
                <RawMetadataTabContent
                  metadataSource={generationDetails.metadataSource}
                  metadataPath={imageForModal?.metadataPath}
                  metadata={imageWithMetadata?.metadata ?? null}
                  isLoading={isMetadataLoading}
                  error={metadataError}
                />
              ) : (
                <WorkflowTabContent
                  isLoading={isMetadataLoading}
                  error={metadataError}
                  workflowDetails={workflowDetails}
                  workflow={workflow}
                />
              )}

              {selectedTab === "details" && (
                <NoteReferencesSection references={noteReferences} />
              )}
            </div>
          </CollapsiblePanel>
        </div>
      </div>
    </div>,
    document.body,
  );
}

