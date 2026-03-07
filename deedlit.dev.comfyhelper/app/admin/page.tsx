"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";

import type {
  AppSettings,
  ImageRecord,
  RootDirectory,
} from "@/lib/library-types";
import { normalizeExcludedTags } from "@/lib/prompt-tags";
import { useRootsQuery, useAddRootMutation, useRemoveRootMutation, useToggleRootVisibilityMutation } from "@/lib/queries/use-roots";
import { useSettingsQuery, useSaveSettingsMutation } from "@/lib/queries/use-settings";
import { useSystemInfoQuery } from "@/lib/queries/use-system";
import { useAdminImagesQuery, useStartScanMutation, useDeleteCachedImageMutation } from "@/lib/queries/use-library";
import { scanJobAtom, scanImageCountAtom, statusMessageAtom } from "@/lib/store/scan-atoms";
import { sseConnectionStateAtom } from "@/lib/store/scan-atoms";

import AdminHeader from "./components/AdminHeader";
import { ConfirmationDialog } from "@deedlit.dev/ui";
import SettingsPanel from "./components/SettingsPanel";
import ScanActionsPanel from "./components/ScanActionsPanel";
import type { DetailedConfirmation, EndpointHealth } from "./components/admin-types";

function formatExcludedTags(tags: string[]): string {
  return tags.join("\n");
}

function parseExcludedTagsInput(input: string): string[] {
  return normalizeExcludedTags(
    input
      .split(/[\r\n,;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

const DEBUG_HEALTH_ENDPOINTS: Array<Pick<EndpointHealth, "id" | "path">> = [
  { id: "roots", path: "/api/roots" },
  { id: "settings", path: "/api/settings" },
  { id: "system", path: "/api/system" },
  { id: "images", path: "/api/images?limit=1" },
  { id: "event-bus", path: "/api/events/health" },
];

function createInitialEndpointHealth(): EndpointHealth[] {
  return DEBUG_HEALTH_ENDPOINTS.map((entry) => ({
    id: entry.id,
    path: entry.path,
    ok: null,
    status: null,
    latencyMs: null,
    checkedAt: null,
    error: null,
  }));
}

export default function AdminPage() {
  // ---- TanStack Query hooks ----
  const rootsQuery = useRootsQuery();
  const settingsQuery = useSettingsQuery();
  const systemQuery = useSystemInfoQuery();

  const roots = rootsQuery.data ?? [];
  const settings: AppSettings =
    settingsQuery.data ?? { galleryColumns: 7, galleryImageLimit: 10000, excludedTags: [], tagFilterPresets: [], trashcanDirectory: null };
  const sqliteInfo = systemQuery.data?.sqlite ?? null;
  const databaseInfo = systemQuery.data?.database ?? null;
  const libraryInfo = systemQuery.data?.library ?? null;

  // ---- Jotai atoms (SSE-driven) ----
  const scanJob = useAtomValue(scanJobAtom);
  const scanImageCount = useAtomValue(scanImageCountAtom);
  const statusMessage = useAtomValue(statusMessageAtom);
  const socketConnectionState = useAtomValue(sseConnectionStateAtom);

  // ---- Form-local state ----
  const [newRootPath, setNewRootPath] = useState("");
  const [galleryColumnsInput, setGalleryColumnsInput] = useState("7");
  const [galleryImageLimitInput, setGalleryImageLimitInput] = useState("10000");
  const [excludedTagsInput, setExcludedTagsInput] = useState("");
  const [excludedTagDraft, setExcludedTagDraft] = useState("");
  const [trashcanDirectoryInput, setTrashcanDirectoryInput] = useState("");

  // ---- Scanned files pagination state ----
  const [fileSearchInput, setFileSearchInput] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [filesPage, setFilesPage] = useState(1);
  const [filesPageSize, setFilesPageSize] = useState(20);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [copiedPathId, setCopiedPathId] = useState<string | null>(null);

  // ---- Admin images query (paginated) ----
  const adminImagesQuery = useAdminImagesQuery(filesPage, filesPageSize, fileSearch);
  const scannedFiles = adminImagesQuery.data?.images ?? [];
  const filesTotal = adminImagesQuery.data?.total ?? 0;
  const scanWarnings = adminImagesQuery.data?.warnings ?? [];
  const scannedAt = adminImagesQuery.data?.scannedAt ?? null;

  // ---- UI state ----
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<DetailedConfirmation | null>(null);

  // ---- Health checks (admin-local) ----
  const [healthChecks, setHealthChecks] = useState<EndpointHealth[]>(() => createInitialEndpointHealth());
  const [isHealthCheckRunning, setIsHealthCheckRunning] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean | null>(null);
  const [userAgent, setUserAgent] = useState<string>("unknown");
  const [documentVisibility, setDocumentVisibility] = useState<string>("unknown");

  const confirmationResolverRef = useRef<((value: boolean) => void) | null>(null);

  // ---- Mutations ----
  const addRootMutation = useAddRootMutation();
  const removeRootMutation = useRemoveRootMutation();
  const toggleRootVisibilityMutation = useToggleRootVisibilityMutation();
  const saveSettingsMutation = useSaveSettingsMutation();
  const startScanMutation = useStartScanMutation();
  const deleteCachedImageMutation = useDeleteCachedImageMutation();

  // ---- Derived state ----
  const isLoading = rootsQuery.isLoading || settingsQuery.isLoading || systemQuery.isLoading;
  const visibleRootCount = roots.filter((root) => root.isVisible).length;
  const hiddenRootCount = roots.length - visibleRootCount;
  const totalFilePages = Math.max(1, Math.ceil(filesTotal / filesPageSize));
  const normalizedExcludedTags = useMemo(() => parseExcludedTagsInput(excludedTagsInput), [excludedTagsInput]);
  const isScanActive = scanJob?.status === "queued" || scanJob?.status === "running";
  const healthyEndpointCount = healthChecks.filter((entry) => entry.ok === true).length;
  const failedEndpointCount = healthChecks.filter((entry) => entry.ok === false).length;
  const hasUnknownEndpointHealth = healthChecks.some((entry) => entry.ok === null);
  const areApisHealthy = failedEndpointCount === 0 && !hasUnknownEndpointHealth;
  const isSocketHealthy = socketConnectionState === "open" || socketConnectionState === "connecting";
  const isAppHealthy = isBrowserOnline === null ? null : isBrowserOnline && areApisHealthy && isSocketHealthy;
  const scanProgressPercent =
    scanJob && scanJob.totalFiles > 0
      ? (scanJob.processedFiles / scanJob.totalFiles) * 100
      : scanJob?.status === "queued"
        ? 4
        : 8;

  const requestDetailedConfirmation = useCallback((input: DetailedConfirmation) => {
    return new Promise<boolean>((resolve) => {
      confirmationResolverRef.current = resolve;
      setConfirmationDialog(input);
    });
  }, []);

  const closeConfirmationDialog = useCallback((accepted: boolean) => {
    const resolver = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmationDialog(null);
    if (resolver) {
      resolver(accepted);
    }
  }, []);

  // Sync form inputs when settings data arrives from the query
  const settingsDataRef = useRef<AppSettings | null>(null);
  useEffect(() => {
    if (settingsQuery.data && settingsQuery.data !== settingsDataRef.current) {
      settingsDataRef.current = settingsQuery.data;
      setGalleryColumnsInput(String(settingsQuery.data.galleryColumns));
      setGalleryImageLimitInput(String(settingsQuery.data.galleryImageLimit));
      setExcludedTagsInput(formatExcludedTags(settingsQuery.data.excludedTags));
      setTrashcanDirectoryInput(settingsQuery.data.trashcanDirectory ?? "");
    }
  }, [settingsQuery.data]);

  const runHealthChecks = useCallback(async () => {
    setIsHealthCheckRunning(true);

    try {
      const checks = await Promise.all(
        DEBUG_HEALTH_ENDPOINTS.map(async (endpoint) => {
          const startedAt = performance.now();

          try {
            const response = await fetch(endpoint.path, { cache: "no-store" });
            return {
              id: endpoint.id,
              path: endpoint.path,
              ok: response.ok,
              status: response.status,
              latencyMs: Math.round(performance.now() - startedAt),
              checkedAt: new Date().toISOString(),
              error: response.ok ? null : `HTTP ${response.status}`,
            } satisfies EndpointHealth;
          } catch (error) {
            return {
              id: endpoint.id,
              path: endpoint.path,
              ok: false,
              status: null,
              latencyMs: Math.round(performance.now() - startedAt),
              checkedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : "Network request failed",
            } satisfies EndpointHealth;
          }
        }),
      );

      setHealthChecks(checks);
      setHealthCheckedAt(new Date().toISOString());
    } finally {
      setIsHealthCheckRunning(false);
    }
  }, []);

  useEffect(() => {
    void runHealthChecks();

    const interval = window.setInterval(() => {
      void runHealthChecks();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [runHealthChecks]);

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    const handleVisibilityChange = () => setDocumentVisibility(document.visibilityState);

    setUserAgent(navigator.userAgent);
    setIsBrowserOnline(navigator.onLine);
    setDocumentVisibility(document.visibilityState);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (confirmationResolverRef.current) {
        confirmationResolverRef.current(false);
        confirmationResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!confirmationDialog) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeConfirmationDialog(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmationDialog, closeConfirmationDialog]);

  async function handleRescan() {
    const confirmed = await requestDetailedConfirmation({
      title: "Confirm library rescan",
      details: [
        `Visible roots selected for scan: ${visibleRootCount}`,
        "A background scan job will walk PNG files and extract metadata.",
      ],
      outcomes: [
        "Start or reuse an asynchronous scan job.",
        "Update scan progress and warnings in real time.",
        "Refresh cached image entries used by gallery/admin views.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setBusyAction("rescan");
    setErrorMessage(null);

    try {
      const data = await startScanMutation.mutateAsync({});
      setErrorMessage(null);
      // statusMessage is set by the mutation's onSuccess via the atom
      if (!data.started) {
        // If a scan was already running, set inline message
        setErrorMessage(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run library scan.";
      setErrorMessage(message);
    } finally {
      setBusyAction(null);
    }
  }

  function handleFileSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilesPage(1);
    setFileSearch(fileSearchInput.trim());
  }

  function handleClearFileSearch() {
    setFileSearchInput("");
    setFileSearch("");
    setFilesPage(1);
  }

  async function handleDeleteScannedFile(image: ImageRecord) {
    const confirmed = await requestDetailedConfirmation({
      title: "Confirm delete cached image entry",
      details: [
        `File: ${image.fileName}`,
        `Relative path: ${image.relativePath}`,
        `Cache id: ${image.id}`,
      ],
      outcomes: [
        "Delete this entry from SQLite `image_cache`.",
        "Remove it from current table/gallery cached results until re-scanned.",
        "Keep the original image file untouched on disk.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setDeletingImageId(image.id);
    setErrorMessage(null);

    try {
      await deleteCachedImageMutation.mutateAsync(image.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete cached entry.";
      setErrorMessage(message);
    } finally {
      setDeletingImageId(null);
    }
  }

  async function handleCopyFullPath(image: ImageRecord) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(image.absolutePath);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = image.absolutePath;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopiedPathId(image.id);
      window.setTimeout(() => {
        setCopiedPathId((current) => (current === image.id ? null : current));
      }, 1200);
    } catch {
      setCopiedPathId(null);
      setErrorMessage("Failed to copy full path.");
    }
  }

  async function handleAddRoot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newRootPath.trim()) {
      return;
    }

    const confirmed = await requestDetailedConfirmation({
      title: "Confirm add root directory",
      details: [
        `Input path: ${newRootPath.trim()}`,
        "Server-side validation will ensure the path exists and is a directory.",
      ],
      outcomes: [
        "Persist this root in SQLite `root_directories`.",
        "Include it in future scans when visible.",
        "Not alter files on disk.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setBusyAction("add-root");
    setErrorMessage(null);

    try {
      await addRootMutation.mutateAsync(newRootPath);
      setNewRootPath("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add root directory.";
      setErrorMessage(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemoveRoot(root: RootDirectory) {
    const confirmed = await requestDetailedConfirmation({
      title: "Confirm remove root directory",
      details: [`Root path: ${root.path}`, `Root id: ${root.id}`],
      outcomes: [
        "Remove this root from SQLite `root_directories`.",
        "Delete cached entries for this root from `image_cache`.",
        "Not delete original files from disk.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setBusyAction(`remove:${root.id}`);
    setErrorMessage(null);

    try {
      await removeRootMutation.mutateAsync(root.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove root directory.";
      setErrorMessage(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleToggleRootVisibility(root: RootDirectory) {
    const nextVisibility = !root.isVisible;
    const confirmed = await requestDetailedConfirmation({
      title: nextVisibility ? "Confirm display root" : "Confirm hide root",
      details: [
        `Root path: ${root.path}`,
        `Current state: ${root.isVisible ? "Visible" : "Hidden"}`,
        `Next state: ${nextVisibility ? "Visible" : "Hidden"}`,
      ],
      outcomes: [
        nextVisibility
          ? "Include this root in visible-root queries and next scans."
          : "Exclude this root from visible-root queries and next scans.",
        "Keep cached rows unless changed by future operations.",
        "Not modify files on disk.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setBusyAction(`visibility:${root.id}`);
    setErrorMessage(null);

    try {
      await toggleRootVisibilityMutation.mutateAsync({ id: root.id, isVisible: nextVisibility });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update root visibility.";
      setErrorMessage(message);
    } finally {
      setBusyAction(null);
    }
  }

  function handleAddExcludedTag() {
    const nextEntries = parseExcludedTagsInput(excludedTagDraft);
    if (nextEntries.length === 0) {
      return;
    }

    const merged = normalizeExcludedTags([...normalizedExcludedTags, ...nextEntries]);
    setExcludedTagsInput(formatExcludedTags(merged));
    setExcludedTagDraft("");
  }

  async function handleSaveSettings() {
    const nextGalleryColumns = Number.parseInt(galleryColumnsInput, 10);
    if (!Number.isFinite(nextGalleryColumns)) {
      setErrorMessage("Gallery columns must be a valid integer.");
      return;
    }

    const nextGalleryImageLimit = Number.parseInt(galleryImageLimitInput, 10);
    if (!Number.isFinite(nextGalleryImageLimit) || nextGalleryImageLimit < 1000 || nextGalleryImageLimit > 50000) {
      setErrorMessage("Gallery image limit must be between 1000 and 50000.");
      return;
    }

    const nextExcludedTags = normalizedExcludedTags;
    const nextTrashcanDirectoryRaw = trashcanDirectoryInput.trim();
    const nextTrashcanDirectory = nextTrashcanDirectoryRaw.length > 0 ? nextTrashcanDirectoryRaw : null;

    const confirmed = await requestDetailedConfirmation({
      title: "Confirm save settings",
      details: [
        `Gallery columns: ${settings.galleryColumns} -> ${nextGalleryColumns}`,
        `Gallery image limit: ${settings.galleryImageLimit} -> ${nextGalleryImageLimit}`,
        `Excluded tags: ${settings.excludedTags.length} -> ${nextExcludedTags.length}`,
        `Trashcan directory: ${settings.trashcanDirectory ?? "(not set)"} -> ${nextTrashcanDirectory ?? "(not set)"}`,
      ],
      outcomes: [
        "Persist values into SQLite `app_settings`.",
        "Apply new defaults for subsequent requests.",
        "Not rewrite existing cached metadata rows.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setBusyAction("save-settings");
    setErrorMessage(null);

    try {
      const saved = await saveSettingsMutation.mutateAsync({
        galleryColumns: nextGalleryColumns,
        galleryImageLimit: nextGalleryImageLimit,
        excludedTags: nextExcludedTags,
        trashcanDirectory: nextTrashcanDirectory,
      });
      setGalleryColumnsInput(String(saved.galleryColumns));
      setGalleryImageLimitInput(String(saved.galleryImageLimit));
      setExcludedTagsInput(formatExcludedTags(saved.excludedTags));
      setTrashcanDirectoryInput(saved.trashcanDirectory ?? "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update settings.";
      setErrorMessage(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshView() {
    const confirmed = await requestDetailedConfirmation({
      title: "Confirm refresh admin view",
      details: ["Reload roots, settings, scan status, and current scanned-file page from APIs."],
      outcomes: [
        "Fetch latest admin data and scanned file table data.",
        "Keep persisted data unchanged.",
        "Replace the current UI state with the newest server values.",
      ],
    });
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    await Promise.all([
      rootsQuery.refetch(),
      settingsQuery.refetch(),
      systemQuery.refetch(),
      adminImagesQuery.refetch(),
    ]);
  }

  return (
    <div id="admin-page" data-testid="admin-page" className="flex w-full flex-col gap-6 xl:gap-8">
      <AdminHeader
        visibleRootCount={visibleRootCount}
        hiddenRootCount={hiddenRootCount}
        settings={settings}
        scannedAt={scannedAt}
      />

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,400px)_minmax(0,1fr)]">
        <SettingsPanel
          sqliteInfo={sqliteInfo}
          databaseInfo={databaseInfo}
          libraryInfo={libraryInfo}
          roots={roots}
          visibleRootCount={visibleRootCount}
          hiddenRootCount={hiddenRootCount}
          galleryColumnsInput={galleryColumnsInput}
          onGalleryColumnsInputChange={setGalleryColumnsInput}
          galleryImageLimitInput={galleryImageLimitInput}
          onGalleryImageLimitInputChange={setGalleryImageLimitInput}
          excludedTagsInput={excludedTagsInput}
          onExcludedTagsInputChange={setExcludedTagsInput}
          excludedTagDraft={excludedTagDraft}
          onExcludedTagDraftChange={setExcludedTagDraft}
          normalizedExcludedTags={normalizedExcludedTags}
          onAddExcludedTag={handleAddExcludedTag}
          trashcanDirectoryInput={trashcanDirectoryInput}
          onTrashcanDirectoryInputChange={setTrashcanDirectoryInput}
          onSaveSettings={() => void handleSaveSettings()}
          busyAction={busyAction}
          newRootPath={newRootPath}
          onNewRootPathChange={setNewRootPath}
          onAddRoot={handleAddRoot}
        />

        <ScanActionsPanel
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          scanWarnings={scanWarnings}
          isLoading={isLoading}
          roots={roots}
          busyAction={busyAction}
          onToggleRootVisibility={(root) => void handleToggleRootVisibility(root)}
          onRemoveRoot={(root) => void handleRemoveRoot(root)}
          scanImageCount={scanImageCount}
          scanJob={scanJob}
          scannedAt={scannedAt}
          isScanActive={isScanActive}
          scanProgressPercent={scanProgressPercent}
          onRefreshView={() => void handleRefreshView()}
          onRescan={() => void handleRescan()}
          visibleRootCount={visibleRootCount}
          debugProps={{
            isAppHealthy,
            isHealthCheckRunning,
            onRunHealthChecks: () => void runHealthChecks(),
            healthChecks,
            healthCheckedAt,
            healthyEndpointCount,
            failedEndpointCount,
            isBrowserOnline,
            documentVisibility,
            isLoading,
            busyAction,
            scanJob,
            scanWarningsCount: scanWarnings.length,
            visibleRootCount,
            libraryInfo,
            sqliteInfo,
            databaseInfo,
            scannedAt,
            userAgent,
          }}
          scannedFilesProps={{
            filesTotal,
            filesPage,
            totalFilePages,
            fileSearchInput,
            onFileSearchInputChange: setFileSearchInput,
            onFileSearchSubmit: handleFileSearchSubmit,
            filesPageSize,
            onFilesPageSizeChange: (value: number) => {
              setFilesPageSize(value);
              setFilesPage(1);
            },
            onClearFileSearch: handleClearFileSearch,
            isFilesLoading: adminImagesQuery.isFetching,
            scannedFiles,
            onCopyFullPath: (image: ImageRecord) => void handleCopyFullPath(image),
            onDeleteScannedFile: (image: ImageRecord) => void handleDeleteScannedFile(image),
            deletingImageId,
            copiedPathId,
            onPrevPage: () => setFilesPage((current) => Math.max(1, current - 1)),
            onNextPage: () => setFilesPage((current) => Math.min(totalFilePages, current + 1)),
          }}
        />
      </section>

      {confirmationDialog && (
        <ConfirmationDialog
          dialog={confirmationDialog}
          onClose={closeConfirmationDialog}
          testIdPrefix="admin-confirmation-dialog"
        />
      )}
    </div>
  );
}

