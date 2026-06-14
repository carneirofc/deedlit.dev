"use client";

import { useCallback, useEffect, useState } from "react";

import { PathInput } from "@/components/PathInput";
import { useActivity } from "@/lib/store/activity";

// ---------------------------------------------------------------------------
// Types mirroring the gateway SourceFolder shape (see lib/api-client.ts). The
// panel speaks to the in-app /api/library/folders proxy routes, which forward
// to the gateway; the catalog owns the data.
// ---------------------------------------------------------------------------
interface SourceFolder {
  id: string;
  path: string;
  label: string | null;
  enabled: boolean;
  recursive: boolean;
  scan_interval_seconds: number;
  last_scan_at: string | null;
  last_scan_status: string | null;
  last_error: string | null;
  image_count: number;
  labeled_count: number;
  unlabeled_count: number;
}

// Shared style tokens (matches app/admin/page.tsx conventions).
const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input:
    "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
};

function scanStatusColor(status: string | null): string {
  switch (status) {
    case "running":
    case "queued":
      return "bg-sky-500/15 text-sky-500";
    case "completed":
      return "bg-emerald-500/15 text-emerald-500";
    case "failed":
      return "bg-rose-500/15 text-rose-500";
    default:
      return "bg-ui-bg text-ui-ink-muted";
  }
}

/** Compact relative-time label ("3m ago"), or "never". */
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SourceFoldersPanel() {
  const { fetchJson, trackJob } = useActivity();

  const [folders, setFolders] = useState<SourceFolder[]>([]);
  const [unlabeled, setUnlabeled] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-folder form.
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newIntervalMin, setNewIntervalMin] = useState("15");
  const [adding, setAdding] = useState(false);

  // Local interval edits keyed by folder id (so polling doesn't clobber typing).
  const [intervalEdits, setIntervalEdits] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    fetch("/api/library/folders")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.folders)) setFolders(j.folders as SourceFolder[]);
      })
      .catch(() => {});
    fetch("/api/library/labels/unlabeled")
      .then((r) => r.json())
      .then((j) => {
        if (typeof j.unlabeled === "number") setUnlabeled(j.unlabeled);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const addFolder = async () => {
    const path = newPath.trim();
    if (!path) {
      setError("A folder path is required.");
      return;
    }
    const minutes = Number(newIntervalMin);
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/library/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          label: newLabel.trim() || null,
          scan_interval_seconds: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes * 60)) : 900,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Add failed");
      setNewPath("");
      setNewLabel("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAdding(false);
    }
  };

  const patchFolder = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/library/folders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const removeFolder = async (id: string) => {
    setError(null);
    try {
      await fetch(`/api/library/folders/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    }
  };

  const scanNow = async (folder: SourceFolder) => {
    const name = folder.label || folder.path.split(/[\\/]/).pop() || folder.path;
    try {
      const j = await fetchJson<{ job_id?: string | null }>(
        `Scan ${name}`,
        `/api/library/folders/${folder.id}/scan`,
        { method: "POST" },
      );
      trackJob(`Scan ${name}`, j.job_id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    }
  };

  const commitInterval = (folder: SourceFolder) => {
    const raw = intervalEdits[folder.id];
    if (raw === undefined) return;
    const minutes = Number(raw);
    setIntervalEdits((prev) => {
      const next = { ...prev };
      delete next[folder.id];
      return next;
    });
    if (!Number.isFinite(minutes)) return;
    const seconds = Math.max(0, Math.round(minutes * 60));
    if (seconds !== folder.scan_interval_seconds) {
      patchFolder(folder.id, { scan_interval_seconds: seconds });
    }
  };

  return (
    <section className={cls.card} data-testid="folders-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-ui-sm font-semibold text-ui-ink-title">
          Source folders
          <span className="ml-2 text-ui-2xs text-ui-ink-muted">live · 3s · auto-scan</span>
        </h2>
        {unlabeled !== null && (
          <span className="text-ui-2xs text-ui-ink-muted" data-testid="unlabeled-count">
            {unlabeled} image{unlabeled === 1 ? "" : "s"} unlabeled library-wide
          </span>
        )}
      </div>

      {/* Add a folder */}
      <div className="flex flex-wrap items-stretch gap-2">
        <PathInput
          className="min-w-[14rem] flex-1"
          inputClassName={`${cls.input} flex-1`}
          buttonClassName={cls.btn}
          value={newPath}
          onChange={setNewPath}
          onEnter={addFolder}
          placeholder="K:/comfyui/.../ComfyUI/output"
          pickerTitle="Choose a folder to watch"
          inputTestId="folder-path-input"
          buttonTestId="folder-browse"
        />
        <input
          className={`${cls.input} w-36`}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          data-testid="folder-label-input"
        />
        <label className="flex items-center gap-1.5 text-ui-xs text-ui-ink-muted">
          every
          <input
            className={`${cls.input} w-16`}
            type="number"
            min={0}
            value={newIntervalMin}
            onChange={(e) => setNewIntervalMin(e.target.value)}
            data-testid="folder-interval-input"
          />
          min
        </label>
        <button
          className={cls.btn}
          onClick={addFolder}
          disabled={adding}
          data-testid="folder-add"
        >
          {adding ? "Adding…" : "Add folder"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-ui-xs text-rose-500" data-testid="folders-error">
          {error}
        </p>
      )}

      {/* Folder list */}
      <div className="mt-3 flex flex-col gap-1">
        {folders.length === 0 ? (
          <p className="text-ui-sm text-ui-ink-muted">No folders configured yet.</p>
        ) : (
          folders.map((f) => {
            const coverage =
              f.image_count > 0 ? Math.round((f.labeled_count / f.image_count) * 100) : 0;
            const intervalMin =
              intervalEdits[f.id] ?? String(Math.round(f.scan_interval_seconds / 60));
            return (
              <div
                key={f.id}
                className="rounded-lg border border-ui-border/50 bg-ui-bg p-3"
                data-testid={`folder-row-${f.id}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {/* Path + label */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-xs text-ui-ink" title={f.path}>
                      {f.label ? <span className="font-medium">{f.label} · </span> : null}
                      {f.path}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-ui-2xs text-ui-ink-muted">
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-medium ${scanStatusColor(f.last_scan_status)}`}
                      >
                        {f.last_scan_status ?? "—"}
                      </span>
                      <span>scanned {relTime(f.last_scan_at)}</span>
                      <span>
                        {f.image_count} img · {f.labeled_count} labeled ({coverage}%)
                        {f.unlabeled_count > 0 ? ` · ${f.unlabeled_count} to label` : ""}
                      </span>
                    </p>
                    {f.last_error && (
                      <p className="mt-0.5 truncate text-ui-2xs text-rose-500" title={f.last_error}>
                        error: {f.last_error}
                      </p>
                    )}
                  </div>

                  {/* Controls */}
                  <label className="flex cursor-pointer items-center gap-1 text-ui-2xs text-ui-ink">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={() => patchFolder(f.id, { enabled: !f.enabled })}
                      data-testid={`folder-enabled-${f.id}`}
                    />
                    auto-scan
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-ui-2xs text-ui-ink">
                    <input
                      type="checkbox"
                      checked={f.recursive}
                      onChange={() => patchFolder(f.id, { recursive: !f.recursive })}
                      data-testid={`folder-recursive-${f.id}`}
                    />
                    recursive
                  </label>
                  <label className="flex items-center gap-1 text-ui-2xs text-ui-ink-muted">
                    every
                    <input
                      className={`${cls.input} w-14 px-2 py-1`}
                      type="number"
                      min={0}
                      value={intervalMin}
                      onChange={(e) =>
                        setIntervalEdits((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      onBlur={() => commitInterval(f)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitInterval(f);
                      }}
                      data-testid={`folder-interval-${f.id}`}
                    />
                    min
                  </label>
                  <button
                    className={cls.btn}
                    onClick={() => scanNow(f)}
                    data-testid={`folder-scan-${f.id}`}
                  >
                    Scan now
                  </button>
                  <button
                    className="rounded-md border border-rose-500/40 px-2 py-1 text-ui-2xs text-rose-500 transition hover:bg-rose-500/10"
                    onClick={() => removeFolder(f.id)}
                    data-testid={`folder-remove-${f.id}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default SourceFoldersPanel;
