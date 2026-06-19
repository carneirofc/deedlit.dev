"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { CodeBlock, CopyButton } from "@deedlit.dev/ui";

import { getIngestConfig, updateIngestConfig, type IngestConfig } from "@/lib/api-client";
import {
  DEFAULT_SETTINGS,
  SAFETY_CLASSES,
  SAFETY_LABEL,
  useSettings,
  type LibrarySettings,
  type SafetyClass,
} from "@/lib/store/settings";

// ---------------------------------------------------------------------------
// Style tokens (matches app/library + app/admin conventions).
// ---------------------------------------------------------------------------

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  select:
    "rounded-lg border border-ui-border/70 bg-ui-bg px-2.5 py-1.5 text-ui-xs outline-none focus:border-accent-cyan",
};

// ---------------------------------------------------------------------------
// Reusable settings rows — each binds to one LibrarySettings key.
// ---------------------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={cls.card}>
      <header className="mb-3">
        <h2 className="text-ui-sm font-semibold text-ui-ink-title">{title}</h2>
        {hint && <p className="text-ui-2xs text-ui-ink-muted">{hint}</p>}
      </header>
      <div className="flex flex-col divide-y divide-ui-border/40">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-ui-sm text-ui-ink">{label}</p>
        {hint && <p className="text-ui-2xs text-ui-ink-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function InfoRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-ui-sm text-ui-ink">{label}</p>
        {hint && <p className="text-ui-2xs text-ui-ink-muted">{hint}</p>}
      </div>
      <span className="shrink-0 rounded-md border border-ui-border/60 bg-ui-bg px-2 py-1 text-ui-2xs text-ui-ink-muted">
        {value}
      </span>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
        checked ? "border-accent-cyan bg-accent-cyan/30" : "border-ui-border/70 bg-ui-bg"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
          checked ? "left-[1.375rem] bg-accent-cyan" : "left-0.5 bg-ui-ink-muted"
        }`}
        style={{ height: "1.125rem", width: "1.125rem" }}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-ui-border/60 bg-ui-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-ui-xs font-medium transition ${
            value === o.value
              ? "bg-accent-cyan/15 text-accent-cyan"
              : "text-ui-ink-muted hover:text-ui-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberSlider({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-44 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-accent-cyan"
      />
      <span className="w-10 text-right text-ui-xs tabular-nums text-ui-ink">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ingest & indexing — SERVER-backed (deedlit.ingest /config via the gateway),
// unlike the rest of this page (browser localStorage). Tunes the producer
// fast-path parallelism live; consumer/deploy knobs are shown read-only.
// ---------------------------------------------------------------------------

function IngestSettingsSection() {
  const [cfg, setCfg] = useState<IngestConfig | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Manual library rescan (walks the source root for new/vanished files). Reuses
  // the existing maintenance job — this is just a trigger from the settings panel.
  const [rescan, setRescan] = useState<"idle" | "running" | "done" | "error">("idle");

  const rescanNow = useCallback(async () => {
    setRescan("running");
    try {
      const r = await fetch("/api/library/maintenance/rescan-files", { method: "POST" });
      setRescan(r.ok ? "done" : "error");
    } catch {
      setRescan("error");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getIngestConfig()
      .then((c) => alive && setCfg(c))
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (patch: Partial<IngestConfig>) => {
    setCfg((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    setStatus("saving");
    try {
      setCfg(await updateIngestConfig(patch));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, []);

  return (
    <Section
      title="Ingest & indexing"
      hint="Server-side ingest parallelism. Applies to the next folder scan — not stored in this browser."
    >
      {cfg === null ? (
        <p className="py-2 text-ui-2xs text-ui-ink-muted">
          {status === "error" ? "Ingest service unreachable." : "Loading…"}
        </p>
      ) : (
        <>
          <Row
            label="Folder-scan publish concurrency"
            hint="How many ingest tasks a scan publishes to the queue in parallel. The worker pool catalogs and projects them across processes."
            control={
              <NumberSlider
                value={cfg.ingest_concurrency}
                min={1}
                max={32}
                step={1}
                onChange={(v) => save({ ingest_concurrency: v })}
              />
            }
          />
          <Row
            label="AI labelling (LLM)"
            hint="Run the vision model to add a description, content-safety class & extra tags to each image. Off skips it — images are still cataloged, embedded & searchable. Applies to new ingests (and the label-backfill sweep)."
            control={
              <Toggle
                checked={cfg.llm_enabled}
                onChange={(v) => save({ llm_enabled: v })}
              />
            }
          />
          <Row
            label="Rescan library now"
            hint="Walk the source folders for new or vanished files and reconcile the catalog. Runs as a background job — watch it on the Admin page."
            control={
              <button
                type="button"
                className={cls.btn}
                onClick={rescanNow}
                disabled={rescan === "running"}
                data-testid="rescan-now"
              >
                {rescan === "running"
                  ? "Starting…"
                  : rescan === "done"
                    ? "Started ✓"
                    : rescan === "error"
                      ? "Retry"
                      : "Rescan"}
              </button>
            }
          />
          <InfoRow
            label="Consumer prefetch (fast queues)"
            value="TASK_PREFETCH"
            hint="Tasks each fast worker runs at once. Deploy-time: set in docker-compose, scale with --scale ingest-worker=N."
          />
          <InfoRow
            label="LLM (label) queue"
            value="single · prefetch 1"
            hint="When AI labelling is on, the label queue runs one exclusive consumer at prefetch 1 so the vision model is never hit concurrently. Fixed."
          />
          <p className="pt-2 text-ui-2xs text-ui-ink-muted" aria-live="polite" data-testid="ingest-config-status">
            {rescan === "error"
              ? "Rescan failed — is the ingest service up?"
              : status === "saving"
                ? "Saving…"
                : status === "saved"
                  ? "Saved."
                  : status === "error"
                    ? "Save failed — is the ingest service up?"
                    : ""}
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Agent access (MCP) — connection details for pointing an AI agent at this
// library over the Model Context Protocol. This app is UI-only; it proxies a
// JSON-RPC MCP server (POST /api/mcp -> deedlit.api gateway POST /mcp) that
// exposes search / retrieval / graph / ingest tools. GET /api/mcp lists them.
// ---------------------------------------------------------------------------

type McpTool = { name: string; description: string };

function McpAccessSection() {
  // Absolute, browser-reachable endpoint. Resolved on the client so the copied
  // URL/config is something an external MCP client can actually dial.
  const [endpoint, setEndpoint] = useState("/api/mcp");
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [toolsState, setToolsState] = useState<"idle" | "loading" | "error">("idle");
  const [copied, setCopied] = useState<"url" | "config" | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setEndpoint(`${window.location.origin}/api/mcp`);
  }, []);

  // Ready-to-paste MCP client config (Claude Desktop / Claude Code `mcpServers`
  // block, HTTP transport). Server name mirrors the gateway's serverInfo.
  const config = useMemo(
    () =>
      JSON.stringify(
        { mcpServers: { "comfyhelper-image-library": { type: "http", url: endpoint } } },
        null,
        2,
      ),
    [endpoint],
  );

  const copy = useCallback((text: string, which: "url" | "config") => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(which);
        setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
      })
      .catch(() => {});
  }, []);

  const loadTools = useCallback(async () => {
    setToolsState("loading");
    try {
      const res = await fetch("/api/mcp");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { tools?: McpTool[] };
      setTools(data.tools ?? []);
      setToolsState("idle");
    } catch {
      setToolsState("error");
    }
  }, []);

  return (
    <Section
      title="Agent access (MCP)"
      hint="Connect an AI agent (Claude, etc.) to this library over the Model Context Protocol. The app exposes a JSON-RPC MCP server with search, retrieval, graph and ingest tools."
    >
      <div className="flex items-center justify-between gap-4 py-2.5">
        <div className="min-w-0">
          <p className="text-ui-sm text-ui-ink">Endpoint</p>
          <p className="truncate font-mono text-ui-2xs text-ui-ink-muted" title={endpoint}>
            {endpoint}
          </p>
        </div>
        <CopyButton
          copied={copied === "url"}
          onClick={() => copy(endpoint, "url")}
          aria-label="Copy MCP endpoint URL"
          data-testid="mcp-copy-url"
        />
      </div>

      <div className="py-2.5">
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-ui-sm text-ui-ink">Client config</p>
            <p className="text-ui-2xs text-ui-ink-muted">
              Add to your MCP client (e.g. Claude Desktop / Claude Code), then restart it.
            </p>
          </div>
          <CopyButton
            copied={copied === "config"}
            onClick={() => copy(config, "config")}
            aria-label="Copy MCP client config"
            data-testid="mcp-copy-config"
          />
        </div>
        <CodeBlock maxHeight="max-h-48" testId="mcp-config">
          {config}
        </CodeBlock>
        <p className="mt-2 text-ui-2xs text-ui-ink-muted">
          Claude Code CLI:{" "}
          <code className="font-mono text-ui-ink">
            claude mcp add --transport http comfyhelper {endpoint}
          </code>
        </p>
      </div>

      <div className="py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-ui-sm text-ui-ink">Available tools</p>
            <p className="text-ui-2xs text-ui-ink-muted">
              The tool surface the agent can call. Served by the gateway; needs it running.
            </p>
          </div>
          <button
            type="button"
            className={cls.btn}
            onClick={loadTools}
            disabled={toolsState === "loading"}
            data-testid="mcp-load-tools"
          >
            {toolsState === "loading" ? "Loading…" : tools ? "Refresh" : "List tools"}
          </button>
        </div>
        {toolsState === "error" && (
          <p className="mt-2 text-ui-2xs text-error-ink">
            Couldn’t reach the MCP server — is the deedlit.api gateway up?
          </p>
        )}
        {tools && tools.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5" data-testid="mcp-tools">
            {tools.map((t) => (
              <li key={t.name} className="text-ui-2xs">
                <code className="font-mono text-accent-cyan">{t.name}</code>
                <span className="text-ui-ink-muted"> — {t.description}</span>
              </li>
            ))}
          </ul>
        )}
        {tools && tools.length === 0 && (
          <p className="mt-2 text-ui-2xs text-ui-ink-muted">No tools advertised.</p>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { settings, setKey, reset, hydrated } = useSettings();

  // Convenience binders so each row reads/writes a single key.
  const bool = (k: keyof LibrarySettings) => ({
    checked: settings[k] as boolean,
    onChange: (v: boolean) => setKey(k, v as never),
  });
  const seg = <T extends string>(k: keyof LibrarySettings) => ({
    value: settings[k] as T,
    onChange: (v: T) => setKey(k, v as never),
  });
  const slide = (k: keyof LibrarySettings) => ({
    value: settings[k] as number,
    onChange: (v: number) => setKey(k, v as never),
  });

  // Toggle one content-safety class in/out of the default-shown set.
  const toggleDefaultSafety = (c: SafetyClass) => {
    const cur = settings.defaultSafety;
    setKey("defaultSafety", cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  };

  const dirty = (Object.keys(DEFAULT_SETTINGS) as Array<keyof LibrarySettings>).some((k) => {
    const a = settings[k];
    const b = DEFAULT_SETTINGS[k];
    // Array settings (e.g. defaultSafety) compare by content, order-insensitive —
    // a reference compare would read as perpetually dirty after hydration.
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return true;
      const sa = [...a].sort();
      const sb = [...b].sort();
      return sa.some((v, i) => v !== sb[i]);
    }
    return a !== b;
  });

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-6" data-testid="settings-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Settings</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Tune browsing, the image viewer, and how suggestions are surfaced.
            Stored locally in this browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cls.btn}
            onClick={reset}
            disabled={!dirty}
            data-testid="settings-reset"
          >
            Reset to defaults
          </button>
          <Link href="/library" prefetch={false} className="text-ui-sm text-accent-cyan">
            ← Back to library
          </Link>
        </div>
      </header>

      {!hydrated && (
        <p className="text-ui-xs text-ui-ink-muted">Loading saved settings…</p>
      )}

      {/* Cards flow into 2–3 balanced columns on wide desktops. CSS multi-column
          (not grid) so uneven card heights pack without leaving row gaps. */}
      <div className="columns-1 gap-6 lg:columns-2 2xl:columns-3 [&>section]:mb-6 [&>section]:break-inside-avoid">
      {/* Browsing & pagination */}
      <Section
        title="Browsing & pagination"
        hint="Controls the library grid, page size, and which tab opens first."
      >
        <Row
          label="Results per page"
          hint="How many images load per request / “Load more” step."
          control={<NumberSlider {...slide("pageSize")} min={10} max={200} step={10} />}
        />
        <Row
          label="Open search on"
          hint="Text/tag search runs a hybrid keyword + semantic match; “By image” opens the reverse-image dropzone."
          control={
            <Segmented
              {...seg<LibrarySettings["defaultMode"]>("defaultMode")}
              options={[
                { value: "browse", label: "Search" },
                { value: "image", label: "By image" },
              ]}
            />
          }
        />
        <Row
          label="Layout"
          hint="How result cards are arranged."
          control={
            <Segmented
              {...seg<LibrarySettings["viewMode"]>("viewMode")}
              options={[
                { value: "grid", label: "Grid" },
                { value: "masonry", label: "Masonry" },
                { value: "list", label: "List" },
              ]}
            />
          }
        />
        <Row
          label="Density"
          hint="Card size / columns for grid & masonry."
          control={
            <Segmented
              {...seg<LibrarySettings["gridDensity"]>("gridDensity")}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "spacious", label: "Spacious" },
              ]}
            />
          }
        />
        <Row
          label="Infinite scroll"
          hint="Auto-load the next page when you reach the bottom."
          control={<Toggle {...bool("infiniteScroll")} />}
        />
        <Row label="Show score chips" control={<Toggle {...bool("showScores")} />} />
        <Row label="Show card metadata" control={<Toggle {...bool("showCardMeta")} />} />
      </Section>

      {/* Image viewer */}
      <Section title="Image viewer" hint="Applied on the single-image detail page.">
        <Row
          label="Image fit"
          control={
            <Segmented
              {...seg<LibrarySettings["viewerImageFit"]>("viewerImageFit")}
              options={[
                { value: "contain", label: "Contain" },
                { value: "cover", label: "Cover" },
              ]}
            />
          }
        />
        <Row
          label="Full-resolution original"
          hint="Stream the source file instead of the thumbnail (slower, sharper)."
          control={<Toggle {...bool("viewerFullResolution")} />}
        />
        <Row label="Show prompt" control={<Toggle {...bool("showPrompt")} />} />
        <Row
          label="Show AI description"
          hint="The vision-model description generated by the label agent."
          control={<Toggle {...bool("showDescription")} />}
        />
        <Row
          label="Show generation parameters"
          control={<Toggle {...bool("showGenerationParams")} />}
        />
        <Row
          label="Show relationship graph"
          control={<Toggle {...bool("showRelationshipGraph")} />}
        />
        <Row
          label="Graph depth"
          hint="How many relationship hops to expand."
          control={<NumberSlider {...slide("graphDepth")} min={1} max={3} step={1} />}
        />
      </Section>

      {/* Suggestions & related */}
      <Section
        title="Suggestions & related items"
        hint="The similar-images and related-tags panels on the viewer."
      >
        <Row label="Show similar images" control={<Toggle {...bool("showSimilar")} />} />
        <Row
          label="Similar images count"
          control={<NumberSlider {...slide("similarCount")} min={0} max={48} step={4} />}
        />
        <Row
          label="Similarity threshold"
          hint="Hide suggestions below this score."
          control={
            <NumberSlider
              {...slide("similarMinScore")}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
            />
          }
        />
        <Row
          label="Load suggestions automatically"
          hint="Off shows a button so the viewer opens faster."
          control={<Toggle {...bool("autoLoadSuggestions")} />}
        />
        <Row label="Show related tags" control={<Toggle {...bool("showRelatedTags")} />} />
        <Row
          label="Related tags count"
          control={<NumberSlider {...slide("relatedTagsCount")} min={0} max={40} step={2} />}
        />
      </Section>

      {/* Slideshow */}
      <Section
        title="Slideshow"
        hint="The fullscreen viewer opened by clicking an image or the Slideshow button."
      >
        <Row
          label="Auto-advance interval"
          hint="Seconds each image is shown while the slideshow is playing."
          control={
            <NumberSlider
              {...slide("slideshowInterval")}
              min={1}
              max={60}
              step={1}
              format={(v) => `${v}s`}
            />
          }
        />
        <Row
          label="Loop"
          hint="Return to the first image after the last."
          control={<Toggle {...bool("slideshowLoop")} />}
        />
        <Row
          label="Shuffle"
          hint="Jump to a random image instead of the next in order."
          control={<Toggle {...bool("slideshowShuffle")} />}
        />
      </Section>

      {/* Search defaults */}
      <Section
        title="Search defaults"
        hint="Initial filter values the browse page opens with."
      >
        <Row
          label="Minimum rating"
          control={
            <select
              className={cls.select}
              value={settings.defaultMinRating}
              onChange={(e) => setKey("defaultMinRating", Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={1}>★+</option>
              <option value={2}>★★+</option>
              <option value={3}>★★★+</option>
              <option value={4}>★★★★+</option>
              <option value={5}>★★★★★</option>
            </select>
          }
        />
        <Row label="Favorites only" control={<Toggle {...bool("defaultFavoritesOnly")} />} />
        <Row
          label="Content safety"
          hint="Which safety classes the grid shows by default. All on = no filter; turn one off (e.g. Explicit) to hide it everywhere until you re-enable it."
          control={
            <div className="flex gap-1.5" data-testid="default-safety">
              {SAFETY_CLASSES.map((c) => {
                const on = settings.defaultSafety.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDefaultSafety(c)}
                    className={`rounded-full border px-2.5 py-1 text-ui-2xs font-medium transition ${
                      on
                        ? "border-accent-cyan bg-accent-cyan/15 text-accent-cyan"
                        : "border-ui-border/60 text-ui-ink-muted hover:text-ui-ink"
                    }`}
                  >
                    {SAFETY_LABEL[c]}
                  </button>
                );
              })}
            </div>
          }
        />
        <Row
          label="Minimum match score"
          hint="Default threshold for semantic / similar / by-image search."
          control={
            <NumberSlider
              {...slide("defaultMinScore")}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
            />
          }
        />
      </Section>

      {/* Ingest & indexing (server-backed, not localStorage) */}
      <IngestSettingsSection />

      {/* Agent access (MCP) — connection details, not stored settings */}
      <McpAccessSection />
      </div>
    </div>
  );
}
