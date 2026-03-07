"use client";

import Image from "next/image";
import type { ImageModalState, WorkflowViewerState, CollectionsHook } from "../hooks";
import type { ImageRecord } from "@/lib/library-types";
import { CollapsiblePanel, MediaStage, MetadataTabBar, Modal, OutlineButton } from "@deedlit.dev/ui";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ModalHeader,
  DetailsTabContent,
  RawMetadataTabContent,
  WorkflowTabContent,
} from "./modal";
import AddToNoteModal from "./modal/AddToNoteModal";
import NoteReferencesSection from "./modal/NoteReferencesSection";
import { useNotesQuery, useCreateNoteMutation, useAddImageToNoteMutation } from "@/lib/queries/use-notes";
import { useNotesByImageQuery } from "@/lib/queries/use-notes";

type ImageDetailsModalProps = {
  modal: ImageModalState;
  workflow: WorkflowViewerState;
  filteredImages: ImageRecord[];
  isDeletingImage: boolean;
  handleDeleteImage: (image: ImageRecord) => Promise<boolean>;
  collections?: CollectionsHook;
};

export default function ImageDetailsModal({
  modal,
  workflow,
  filteredImages,
  isDeletingImage,
  handleDeleteImage,
  collections,
}: ImageDetailsModalProps) {
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isAddToNoteOpen, setIsAddToNoteOpen] = useState(false);

  // Notes data fetching — lifted out of AddToNoteModal
  const { data: notesData, isLoading: isNotesLoading } = useNotesQuery();
  const createNote = useCreateNoteMutation();
  const addImage = useAddImageToNoteMutation();
  const { data: noteReferences } = useNotesByImageQuery(modal.selectedImage?.id ?? "");

  const {
    selectedImage,
    selectedImageDetails,
    selectedImageIndex,
    selectedImageUrl,
    selectedImageForModal,
    selectedImageWithMetadata,
    isSelectedImageMetadataLoading,
    selectedImageMetadataError,
    navigateSelectedImage,
    randomizeSelectedImage,
    handleDeletedImage,
    closeSelectedImageModal,
    isSlideshowMode,
    setIsSlideshowMode,
    copiedPrompt,
    handlePromptCopy,
    selectedModalTab,
    setSelectedModalTab,
  } = modal;

  if (!selectedImage || !selectedImageDetails) return null;
  if (typeof document === "undefined") return null;

  const handleDeleteSelectedImage = async () => {
    setIsDeleteConfirmOpen(true);
  };

  const confirmDeleteSelectedImage = async () => {
    setIsDeleteConfirmOpen(false);
    const deleted = await handleDeleteImage(selectedImage);
    if (deleted) {
      handleDeletedImage(selectedImage);
    }
  };

  const isWorkflowTab = selectedModalTab === "workflow";

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = selectedImageUrl;
    link.download = selectedImage.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ui-overlay-strong p-0 sm:p-4 md:pl-[calc(var(--app-sidebar-width)+1rem)]"
        onClick={closeSelectedImageModal}
      >
        <div
          className="flex h-full max-h-full w-full max-w-425 flex-col overflow-hidden rounded-none border-0 border-ui-border-modal bg-ui-bg-card shadow-ui-strong sm:h-auto sm:rounded-2xl sm:border lg:h-full"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalHeader
            image={selectedImage}
            imageUrl={selectedImageUrl}
            imageIndex={selectedImageIndex}
            totalImages={filteredImages.length}
            isSlideshowMode={isSlideshowMode}
            isDeletingImage={isDeletingImage}
            onRandomize={() => randomizeSelectedImage()}
            onToggleSlideshow={() => setIsSlideshowMode((current) => !current)}
            onDeleteImage={() => void handleDeleteSelectedImage()}
            onDownload={handleDownload}
            onAddToNote={() => setIsAddToNoteOpen(true)}
            onClose={closeSelectedImageModal}
            collections={collections}
          />

          {/* Desktop layout: side-by-side grid */}
          <div
            className={`hidden min-h-0 flex-1 gap-0 lg:grid lg:grid-rows-[1fr] ${isWorkflowTab
              ? "grid-cols-1"
              : "lg:grid-cols-[minmax(0,0.85fr)_minmax(320px,1.15fr)]"
              }`}
          >
            <MediaStage
              hidden={isWorkflowTab}
              canNavigate={filteredImages.length >= 2 && selectedImageIndex >= 0}
              onNavigate={navigateSelectedImage}
              previousLabel="Previous image"
              nextLabel="Next image"
            >
              <Image
                src={selectedImageUrl}
                alt={selectedImage.fileName}
                fill
                sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, 100vw"
                quality={95}
                className="object-contain object-center"
              />
            </MediaStage>

            <div
              className={
                isWorkflowTab
                  ? "min-h-0 overflow-hidden border-t border-ui-border p-3"
                  : "min-h-0 overflow-auto border-l border-ui-border p-4"
              }
            >
              <div className={isWorkflowTab ? "flex h-full flex-col gap-3" : "space-y-3"}>
                <MetadataTabBar value={selectedModalTab} onValueChange={setSelectedModalTab} />

                {selectedModalTab === "details" ? (
                  <DetailsTabContent
                    details={selectedImageDetails}
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                    copiedPrompt={copiedPrompt}
                    onPromptCopy={handlePromptCopy}
                  />
                ) : selectedModalTab === "raw" ? (
                  <RawMetadataTabContent
                    metadataSource={selectedImageDetails.metadataSource}
                    metadataPath={selectedImageForModal?.metadataPath}
                    metadata={selectedImageWithMetadata?.metadata ?? null}
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                  />
                ) : (
                  <WorkflowTabContent
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                    workflowDetails={modal.selectedWorkflowDetails}
                    workflow={workflow}
                  />
                )}

                {selectedModalTab === "details" && (
                  <NoteReferencesSection references={noteReferences} />
                )}
              </div>
            </div>
          </div>

          {/* Mobile layout: image on top, collapsible details below */}
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <MediaStage
              hidden={false}
              canNavigate={filteredImages.length >= 2 && selectedImageIndex >= 0}
              onNavigate={navigateSelectedImage}
              previousLabel="Previous image"
              nextLabel="Next image"
              className="min-h-[40vh] flex-1"
            >
              <Image
                src={selectedImageUrl}
                alt={selectedImage.fileName}
                fill
                sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, 100vw"
                quality={95}
                className="object-contain object-center"
              />
            </MediaStage>

            <CollapsiblePanel
              label={selectedModalTab === "raw" ? "Raw Metadata" : selectedModalTab === "workflow" ? "Workflow" : "Details"}
              defaultOpen={false}
              className="border-t border-ui-border"
              contentClassName={
                isWorkflowTab
                  ? "max-h-[60vh] min-h-50 overflow-hidden border-t border-ui-border p-3"
                  : "max-h-[60vh] overflow-auto border-t border-ui-border p-4"
              }
            >
              <div className={isWorkflowTab ? "flex h-full flex-col gap-3" : "space-y-3"}>
                <MetadataTabBar value={selectedModalTab} onValueChange={setSelectedModalTab} />

                {selectedModalTab === "details" ? (
                  <DetailsTabContent
                    details={selectedImageDetails}
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                    copiedPrompt={copiedPrompt}
                    onPromptCopy={handlePromptCopy}
                  />
                ) : selectedModalTab === "raw" ? (
                  <RawMetadataTabContent
                    metadataSource={selectedImageDetails.metadataSource}
                    metadataPath={selectedImageForModal?.metadataPath}
                    metadata={selectedImageWithMetadata?.metadata ?? null}
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                  />
                ) : (
                  <WorkflowTabContent
                    isLoading={isSelectedImageMetadataLoading}
                    error={selectedImageMetadataError}
                    workflowDetails={modal.selectedWorkflowDetails}
                    workflow={workflow}
                  />
                )}

                {selectedModalTab === "details" && (
                  <NoteReferencesSection references={noteReferences} />
                )}
              </div>
            </CollapsiblePanel>
          </div>
        </div>
      </div>

      <Modal
        open={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Move Image To Trash"
        description={selectedImage.fileName}
        closeLabel="Close delete confirmation"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <OutlineButton
              type="button"
              onClick={() => setIsDeleteConfirmOpen(false)}
              disabled={isDeletingImage}
            >
              Cancel
            </OutlineButton>
            <OutlineButton
              type="button"
              variant="danger"
              onClick={() => void confirmDeleteSelectedImage()}
              disabled={isDeletingImage}
            >
              {isDeletingImage ? "Moving..." : "Move To Trash"}
            </OutlineButton>
          </div>
        }
      >
        <p className="text-ui-sm text-ui-ink-subtle">{selectedImage.relativePath}</p>
      </Modal>

      <AddToNoteModal
        open={isAddToNoteOpen}
        onClose={() => setIsAddToNoteOpen(false)}
        notes={notesData}
        isLoading={isNotesLoading}
        onAddToNote={async (noteId) => {
          await addImage.mutateAsync({ noteId, imageCacheId: selectedImage.id });
        }}
        onCreateAndAdd={async (title) => {
          const note = await createNote.mutateAsync(title);
          await addImage.mutateAsync({ noteId: note.id, imageCacheId: selectedImage.id });
        }}
      />
    </>,
    document.body,
  );
}

