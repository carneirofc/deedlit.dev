"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { getIngestConfig, updateIngestConfig, type IngestConfig } from "@/lib/api-client";
import {
  DEFAULT_SETTINGS,
  useSettings,
  type LibrarySettings,
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
            label="Folder-scan concurrency"
            hint="How many files are cataloged in parallel during a scan (the fast path)."
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
            label="Route scans via the ingest queue"
            hint="Catalog files across worker processes instead of inline. Falls back to inline if the broker is down."
            control={
              <Toggle
                checked={cfg.ingest_via_queue}
                onChange={(v) => save({ ingest_via_queue: v })}
              />
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
            hint="Exclusive consumer + prefetch 1 so the vision model is never hit concurrently. Fixed."
          />
          <p className="pt-2 text-ui-2xs text-ui-ink-muted" aria-live="polite" data-testid="ingest-config-status">
            {status === "saving"
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

  const dirty = (Object.keys(DEFAULT_SETTINGS) as Array<keyof LibrarySettings>).some(
    (k) => settings[k] !== DEFAULT_SETTINGS[k],
  );

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
      </div>
    </div>
  );
}
