/**
 * deedlit.api gateway client — the ONLY data source for the comfyhelper UI.
 *
 * comfyhelper is UI-only: it holds no database connections and talks to no
 * datastore directly. Every read/write goes through the single BFF gateway
 * (`deedlit.api`) over HTTP. This module is the seam: typed calls to the
 * gateway endpoints (see contracts/api.openapi.yaml) plus mappers that adapt
 * the gateway/downstream contract shapes into the shapes the existing React
 * surfaces already consume (CompactResult, the detail-page record, Graph).
 *
 * Endpoints used:
 *   GET  /detail/{sha256}  -> { image, similar, neighbors }
 *   POST /search           -> { hits: [{ sha256, score, payload }] }
 *   GET  /stats            -> { images, tags, collections, notes }
 *   GET  /jobs / POST /jobs
 *   GET  /health           -> { status, services: [{ name, status }] }
 *   POST /mcp              -> JSON-RPC (clusters/compare/related-tags/lineage)
 *
 * Base URL: DEEDLIT_API_URL (server-side, default http://localhost:8088). When
 * a value is needed in the browser, NEXT_PUBLIC_DEEDLIT_API_URL is consulted
 * first. In practice the React surfaces call the in-app /api/library/* routes,
 * which run server-side and proxy through this client, so the browser never
 * needs the gateway URL directly — but the public var is supported for a
 * future direct-fetch path.
 */
import type {
  CompactResult,
  Graph,
  GenerationParams,
  ImageTag,
  LoraRef,
} from "@/lib/library/schemas";

// ---------------------------------------------------------------------------
// Base URL + low-level request
// ---------------------------------------------------------------------------

export function getGatewayBaseUrl(): string {
  const server = process.env.DEEDLIT_API_URL?.trim();
  const pub = process.env.NEXT_PUBLIC_DEEDLIT_API_URL?.trim();
  return (server || pub || "http://localhost:8088").replace(/\/+$/, "");
}

/**
 * Base URL for fetching image blobs (thumbnails / originals).
 *
 * The catalog owns blobs at GET /blobs/{sha256}/{kind}; the gateway now proxies
 * them at the same path (deedlit.api GET /blobs/{sha256}/{kind}). Since
 * comfyhelper is UI-only it can't stream bytes from a datastore itself, so the
 * thumbnail/file routes proxy through this base. DEEDLIT_BLOB_URL overrides it
 * (e.g. to hit the catalog directly in a dev setup); when unset we default to
 * the gateway, which is the canonical blob source.
 */
export function getBlobBaseUrl(): string | null {
  const v = process.env.DEEDLIT_BLOB_URL?.trim();
  return (v ? v : getGatewayBaseUrl()).replace(/\/+$/, "");
}

/** Build the upstream blob URL for an image, or null if blob serving is unconfigured. */
export function blobUrl(sha256: string, kind: "thumbnail" | "embedding" | "original"): string | null {
  const base = getBlobBaseUrl();
  if (!base) return null;
  // catalog serves thumbnail/embedding; "original" maps to the image bytes.
  const catalogKind = kind === "original" ? "thumbnail" : kind;
  return `${base}/blobs/${encodeURIComponent(sha256)}/${catalogKind}`;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Query params appended to the path. An array value is emitted as a repeated
   * param (?k=a&k=b); undefined values and empty arrays are skipped.
   */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const base = getGatewayBaseUrl();
  const url = new URL(`${base}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const method = opts.method ?? "GET";
  const init: RequestInit = {
    method,
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    // Always fetch fresh; the UI controls its own caching.
    cache: "no-store",
  };

  let res: Response;
  try {
    res = await fetch(url.toString(), init);
  } catch (cause) {
    throw new GatewayError(
      `gateway unreachable at ${base} (${method} ${path})`,
      503,
      cause,
    );
  }

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    const msg =
      (detail && typeof detail === "object" && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : undefined) ?? `gateway ${method} ${path} -> ${res.status}`;
    throw new GatewayError(msg, res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Gateway / downstream contract shapes (see contracts/*.openapi.yaml)
// ---------------------------------------------------------------------------

/** A scored hit from deedlit.search (proxied through the gateway). */
export interface SearchHit {
  sha256: string;
  score: number;
  payload?: Record<string, unknown> | null;
}

export interface SearchResponse {
  fusion?: "rrf" | "dense" | "sparse";
  hits: SearchHit[];
}

/** A graph neighbor from deedlit.graph (proxied through the gateway). */
export interface GraphNeighbor {
  sha256: string;
  relation: string;
  weight?: number;
}

/** The catalog Image record (canonical metadata). */
export interface CatalogImage {
  sha256: string;
  phash?: string | null;
  width?: number | null;
  height?: number | null;
  sourceTool?: string | null;
  prompt?: string | null;
  negative?: string | null;
  tags?: string[];
  params?: {
    seed?: number | null;
    steps?: number | null;
    cfg?: number | null;
    sampler?: string | null;
    scheduler?: string | null;
    denoise?: number | null;
    clipskip?: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
  references?: Array<{ kind: string; name: string; hash?: string | null }>;
  rating?: number | null;
  favorite?: boolean;
  /** AI-generated description (deedlit.labelagent), persisted by the catalog. */
  description?: string | null;
  created_at?: string;
  // tolerate extra payload fields the gateway forwards
  [key: string]: unknown;
}

/** Aggregated detail response from the gateway. */
export interface DetailResponse {
  image: CatalogImage;
  similar: SearchHit[];
  neighbors: GraphNeighbor[];
}

export interface StatsResponse {
  images: number;
  tags?: number;
  collections?: number;
  notes?: number;
}

export interface ServiceHealth {
  name: string;
  status: "ok" | "degraded" | "down";
  /**
   * Downstream readiness flags forwarded verbatim by the gateway, e.g.
   * { db_ready, blob_ready } (catalog), { neo4j_ready } (graph),
   * { collection_ready } (search), { vision_ready, sparse_ready } (vision).
   */
  detail?: Record<string, unknown>;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  services?: ServiceHealth[];
}

/**
 * One service's live work snapshot, as aggregated by the gateway GET /activity.
 * `per_min` is the trailing-60s completion rate; `busy` is `inflight > 0`;
 * `reachable` is false when the gateway couldn't reach that service's /activity.
 */
export interface ServiceActivity {
  name: string;
  inflight: number;
  per_min: number;
  busy: boolean;
  last_op: string | null;
  reachable: boolean;
}

export interface ActivityResponse {
  services: ServiceActivity[];
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

export async function getDetail(sha256: string, signal?: AbortSignal): Promise<DetailResponse> {
  return request<DetailResponse>(`/detail/${encodeURIComponent(sha256)}`, { signal });
}

/** Per-store outcome of un-indexing an image (DELETE /images/{sha256}). */
export interface DeleteImageResult {
  status: string;
  sha256: string;
  /** Catalog record removed (always true on success — catalog is the truth). */
  catalog: boolean;
  /** Search vector removed (best-effort projection cleanup). */
  search: boolean;
  /** Graph node/edges removed (best-effort projection cleanup). */
  graph: boolean;
}

/**
 * Delete an image's INDEXATION — catalog record + search vector + graph node —
 * NOT the original file on disk. Proxies the gateway DELETE /images/{sha256},
 * which removes the catalog record first (source of truth) then cleans the
 * derived projections. A {@link GatewayError} with status 404 means the image
 * is not in the library.
 */
export async function deleteImage(sha256: string, signal?: AbortSignal): Promise<DeleteImageResult> {
  return request<DeleteImageResult>(`/images/${encodeURIComponent(sha256)}`, {
    method: "DELETE",
    signal,
  });
}

/** Outcome of a bulk un-index (gateway POST /images/batch-delete). */
export interface BatchDeleteResult {
  /** sha256s whose catalog record was removed by this call. */
  deleted: string[];
  /** sha256s that were not in the catalog (already gone). */
  missing: string[];
  /** Search points removed for the deleted set (best-effort projection cleanup). */
  search: boolean;
  /** Graph nodes removed for the deleted set (best-effort projection cleanup). */
  graph: boolean;
}

/**
 * Bulk un-index MANY images in ONE call — catalog record + search vector + graph
 * node for each, NOT the source files on disk. Proxies the gateway POST
 * /images/batch-delete, which does a single batch op per store (vs N per-image
 * deletes). De-dupes server-side; capped at 1000 ids per call.
 */
export async function batchDeleteImages(
  sha256s: string[],
  signal?: AbortSignal,
): Promise<BatchDeleteResult> {
  const res = await request<Partial<BatchDeleteResult>>("/images/batch-delete", {
    method: "POST",
    body: { sha256s },
    signal,
  });
  return {
    deleted: Array.isArray(res?.deleted) ? res.deleted : [],
    missing: Array.isArray(res?.missing) ? res.missing : [],
    search: Boolean(res?.search),
    graph: Boolean(res?.graph),
  };
}

export interface GatewaySearchRequest {
  query: string;
  limit?: number;
  /** Rank offset for server-side pagination over the whole matching set. */
  offset?: number;
  filter?: Record<string, unknown> | null;
}

export async function search(req: GatewaySearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await request<SearchResponse>("/search", { method: "POST", body: req, signal });
  return { fusion: res?.fusion, hits: Array.isArray(res?.hits) ? res.hits : [] };
}

export async function getStats(signal?: AbortSignal): Promise<StatsResponse> {
  return request<StatsResponse>("/stats", { signal });
}

export async function listJobs(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const res = await request<unknown>("/jobs", { signal });
  return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [];
}

export async function dispatchJob(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>("/jobs", { method: "POST", body: payload, signal });
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { signal });
}

/**
 * Live per-service activity (in-flight / throughput / current op), aggregated by
 * the gateway GET /activity. Tolerates a missing/odd `services` field by
 * returning an empty list so the status board degrades to its health-only view.
 */
export async function getActivity(signal?: AbortSignal): Promise<ActivityResponse> {
  const res = await request<ActivityResponse>("/activity", { signal });
  return { services: Array.isArray(res?.services) ? res.services : [] };
}

// ---------------------------------------------------------------------------
// Filesystem browse — the admin directory picker. The gateway proxies this to
// deedlit.ingest, which owns the host filesystem the ingest paths live on.
// comfyhelper itself has no filesystem access, so this is the only way the
// picker can list folders.
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FsRoot {
  label: string;
  path: string;
}

export interface FsBrowseResult {
  /** Absolute path being listed, or null for the synthetic "roots" view. */
  path: string | null;
  /** Parent directory, or null when already at a drive/filesystem root. */
  parent: string | null;
  separator: string;
  entries: FsEntry[];
  /** Quick-access jump targets (drives, home, cwd) shown in every view. */
  roots: FsRoot[];
}

/**
 * List a directory on the ingest host. Passing null/empty returns the roots
 * view. A {@link GatewayError} with status 400 means the path is missing /
 * denied / not a folder — user-correctable, surfaced inline by the picker.
 */
export async function browseFs(path: string | null, signal?: AbortSignal): Promise<FsBrowseResult> {
  return request<FsBrowseResult>("/fs/browse", {
    query: path ? { path } : undefined,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Source folders — the configured-ingest-folder registry, proxied through the
// gateway /folders routes (catalog owns the data). The registry persists which
// folders to scan; a background scheduler in ingest re-walks each on its own
// interval and writes the last-scan state back, which these reads surface.
// ---------------------------------------------------------------------------

/** A configured source folder + its derived coverage. */
export interface SourceFolder {
  id: string;
  path: string;
  label: string | null;
  enabled: boolean;
  recursive: boolean;
  scan_interval_seconds: number;
  last_scan_at: string | null;
  last_scan_status: string | null;
  last_scan_job_id: string | null;
  last_error: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Images whose source path is under this folder (derived). */
  image_count: number;
  /** Of those, how many have an AI label/description. */
  labeled_count: number;
  unlabeled_count: number;
}

/** Writable fields when registering a folder. */
export interface SourceFolderUpsert {
  path: string;
  label?: string | null;
  enabled?: boolean;
  recursive?: boolean;
  scan_interval_seconds?: number;
}

/** Partial folder update (toggle enabled/recursive, edit interval/label). */
export interface SourceFolderPatch {
  label?: string | null;
  enabled?: boolean;
  recursive?: boolean;
  scan_interval_seconds?: number;
}

export async function listSourceFolders(signal?: AbortSignal): Promise<SourceFolder[]> {
  const res = await request<unknown>("/folders", { signal });
  return Array.isArray(res) ? (res as SourceFolder[]) : [];
}

export async function createSourceFolder(body: SourceFolderUpsert, signal?: AbortSignal): Promise<SourceFolder> {
  return request<SourceFolder>("/folders", { method: "POST", body, signal });
}

export async function updateSourceFolder(
  id: string,
  body: SourceFolderPatch,
  signal?: AbortSignal,
): Promise<SourceFolder> {
  return request<SourceFolder>(`/folders/${encodeURIComponent(id)}`, { method: "PATCH", body, signal });
}

export async function deleteSourceFolder(id: string, signal?: AbortSignal): Promise<void> {
  await request<unknown>(`/folders/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}

/** Dispatch an immediate ingest scan of a configured folder ("Scan now"). */
export async function scanSourceFolder(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/folders/${encodeURIComponent(id)}/scan`, {
    method: "POST",
    signal,
  });
}

/** sha256 of every cataloged image missing an AI label (library-wide). */
export async function listUnlabeled(signal?: AbortSignal): Promise<string[]> {
  const res = await request<{ sha256?: string[] }>("/images/unlabeled", { signal });
  return Array.isArray(res?.sha256) ? res.sha256 : [];
}

// ---------------------------------------------------------------------------
// Async task queues + ledger (ADR 0001) — backs the queue visualization page.
// Live queue stats + DLQ ops come from the gateway's RabbitMQ management proxy;
// per-image task history comes from the catalog tasks ledger (/tasks).
// ---------------------------------------------------------------------------

/** Live stats for one RabbitMQ queue (from the gateway mgmt proxy). */
export interface QueueStat {
  name: string;
  reachable: boolean;
  messages: number;
  messages_ready: number;
  messages_unacknowledged: number;
  consumers: number;
  publish_rate: number;
  deliver_rate: number;
}

export async function listQueues(signal?: AbortSignal): Promise<QueueStat[]> {
  const res = await request<{ queues?: QueueStat[] }>("/queues", { signal });
  return Array.isArray(res?.queues) ? res.queues : [];
}

/** One peeked message (non-destructive) — payload + AMQP routing/delivery detail. */
export interface QueueMessage {
  payload: string | null;
  /** AMQP headers (incl. x-attempt / x-error on retried/dead-lettered tasks). */
  headers: Record<string, unknown>;
  /** Payload size in bytes (RabbitMQ payload_bytes). */
  payload_bytes?: number;
  payload_encoding?: string;
  /** True when this message was previously delivered and requeued. */
  redelivered?: boolean;
  routing_key?: string;
  exchange?: string;
  /** Full AMQP properties: content_type, delivery_mode, timestamp, headers… */
  properties?: Record<string, unknown>;
}

/** Result of a non-destructive queue peek: the sampled messages + depth left. */
export interface QueuePeek {
  messages: QueueMessage[];
  /** Messages still queued after the peek (the sample is requeued, not consumed). */
  remaining: number;
}

export async function peekQueueMessages(
  name: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<QueuePeek> {
  const res = await request<{ messages?: QueueMessage[]; remaining?: number }>(
    `/queues/${encodeURIComponent(name)}/messages`,
    { query: { limit }, signal },
  );
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    remaining: typeof res?.remaining === "number" ? res.remaining : 0,
  };
}

/** Purge all messages from a queue (destructive). */
export async function purgeQueue(name: string, signal?: AbortSignal): Promise<void> {
  await request(`/queues/${encodeURIComponent(name)}/purge`, { method: "POST", signal });
}

/** Requeue the DLQ of a base queue (index|label) back to the main queue. */
export async function requeueDlq(base: string, signal?: AbortSignal): Promise<{ count: number }> {
  return request<{ count: number }>(`/dlq/${encodeURIComponent(base)}/requeue`, {
    method: "POST",
    signal,
  });
}

/** A row from the catalog tasks ledger (per-image async task history). */
export interface Task {
  id: string;
  sha256: string;
  type: "index" | "label";
  status: "queued" | "running" | "done" | "failed" | "dlq";
  attempts: number;
  error: string | null;
  parent_op_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function listTasks(
  params: { sha256?: string; type?: string; status?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Task[]> {
  const res = await request<unknown>("/tasks", { query: params, signal });
  return Array.isArray(res) ? (res as Task[]) : [];
}

// ---------------------------------------------------------------------------
// Ingest runtime config (ADR 0002) — the live producer parallelism knobs the
// settings panel tunes. Folder-scan concurrency + the opt-in ingest-queue route.
// Consumer-side parallelism (broker prefetch, worker replicas) is deploy-time
// and not settable here.
// ---------------------------------------------------------------------------

export interface IngestConfig {
  /** How many `ingest` tasks a folder scan publishes concurrently. */
  ingest_concurrency: number;
  /**
   * Master switch for the vision-LLM (labelagent) enrichment stage. When off,
   * ingest skips the `label` stage so images are cataloged + indexed without an
   * AI description/safety/tags. On by default (labelagent must also be configured).
   */
  llm_enabled: boolean;
}

export async function getIngestConfig(signal?: AbortSignal): Promise<IngestConfig> {
  const res = await request<Partial<IngestConfig>>("/ingest/config", { signal });
  return {
    ingest_concurrency:
      typeof res?.ingest_concurrency === "number" ? res.ingest_concurrency : 8,
    // Default ON when the field is absent (older ingest builds) — matches the
    // service default so the toggle doesn't read as off against an unset value.
    llm_enabled: res?.llm_enabled !== false,
  };
}

export async function updateIngestConfig(
  patch: Partial<IngestConfig>,
  signal?: AbortSignal,
): Promise<IngestConfig> {
  return request<IngestConfig>("/ingest/config", { method: "PUT", body: patch, signal });
}

// ---------------------------------------------------------------------------
// Catalog admin (#30) — the DB power-user page works against the RAW catalog
// records (full prompt/params/workflow_json/api_prompt_json), not the search
// CompactResult shape. List/patch proxy the gateway /images routes; re-index /
// re-label dispatch single tasks via ingest; delete-everywhere reuses
// deleteImage (the fan-out un-index above).
// ---------------------------------------------------------------------------

/** Server-side browse/sort/filter knobs for the catalog `GET /images` grid. */
export type CatalogSort =
  | "newest"
  | "oldest"
  | "created_desc"
  | "created_asc"
  | "rating_desc"
  | "rating_asc"
  | "name_asc"
  | "name_desc";

export interface CatalogBrowseParams {
  /** Include tags — image must carry ALL of them (AND). */
  tags?: string[];
  /** Exclude tags — image must carry NONE of them. */
  excludeTags?: string[];
  favorite?: boolean;
  /** Keep images rated at least this (0–5). */
  ratingGte?: number;
  /** Content-safety classes to include; omit/empty = all. */
  safety?: string[];
  /** Keep images whose on-disk path contains this fragment (separator-insensitive). */
  path?: string;
  sort?: CatalogSort;
  limit?: number;
  offset?: number;
}

/** Browse raw catalog records (gateway GET /images), sorted + paginated. */
export async function listCatalogImages(
  params: CatalogBrowseParams = {},
  signal?: AbortSignal,
): Promise<CatalogImage[]> {
  const res = await request<unknown>("/images", {
    query: {
      tag: params.tags,
      exclude_tag: params.excludeTags,
      favorite: params.favorite,
      rating_gte: params.ratingGte,
      safety: params.safety,
      path: params.path,
      sort: params.sort,
      limit: params.limit,
      offset: params.offset,
    },
    signal,
  });
  return Array.isArray(res) ? (res as CatalogImage[]) : [];
}

/**
 * Tag-name autocomplete (gateway GET /tags) — names matching `prefix`, ranked
 * most-used first. Backs the live type-ahead in the library tag filter. An empty
 * prefix returns the globally most-used tags; the gateway degrades to [].
 */
export async function suggestTags(
  prefix: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await request<unknown>("/tags", { query: { prefix, limit }, signal });
  return Array.isArray(res) ? (res as string[]) : [];
}

/** Curated, editable catalog fields (gateway PATCH /images/{sha}). */
export interface ImagePatchBody {
  rating?: number | null;
  favorite?: boolean;
  tags?: string[];
  safety?: "sfw" | "nsfw" | "explicit" | null;
  prompt?: string | null;
  negative?: string | null;
}

export async function patchImage(
  sha256: string,
  body: ImagePatchBody,
  signal?: AbortSignal,
): Promise<CatalogImage> {
  return request<CatalogImage>(`/images/${encodeURIComponent(sha256)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

/** Re-project one image (gateway POST /images/{sha}/reindex -> index task). */
export async function reindexImage(sha256: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/images/${encodeURIComponent(sha256)}/reindex`, {
    method: "POST",
    signal,
  });
}

/** Re-label one image (gateway POST /images/{sha}/relabel -> label task). */
export async function relabelImage(sha256: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/images/${encodeURIComponent(sha256)}/relabel`, {
    method: "POST",
    signal,
  });
}

// ---------------------------------------------------------------------------
// Notes — the catalog "note" record (Editor.js block document + positive /
// negative prompt fields + ordered image refs by sha256), proxied through the
// gateway /notes routes. `blocks` is the raw Editor.js OutputData document; the
// gateway/catalog stores it opaquely so the editor round-trips it verbatim.
// ---------------------------------------------------------------------------

/** Editor.js document (kept opaque; the editor owns the exact shape). */
export type NoteBlocks = Record<string, unknown>;

/** The writable fields of a note (POST /notes, PUT /notes/{id}). */
export interface NoteUpsert {
  title?: string | null;
  positive?: string | null;
  negative?: string | null;
  /** Editor.js OutputData document. */
  blocks: NoteBlocks;
  /** Ordered image references by sha256. */
  imageRefs: string[];
}

/** A persisted note (NoteUpsert + server-assigned id / timestamp). */
export interface Note extends NoteUpsert {
  id: string;
  created_at?: string;
}

export async function createNote(body: NoteUpsert, signal?: AbortSignal): Promise<Note> {
  return request<Note>("/notes", { method: "POST", body, signal });
}

export async function getNote(id: string, signal?: AbortSignal): Promise<Note> {
  return request<Note>(`/notes/${encodeURIComponent(id)}`, { signal });
}

export async function updateNote(id: string, body: NoteUpsert, signal?: AbortSignal): Promise<Note> {
  return request<Note>(`/notes/${encodeURIComponent(id)}`, { method: "PUT", body, signal });
}

export async function exportNote(id: string, signal?: AbortSignal): Promise<Note> {
  return request<Note>(`/notes/${encodeURIComponent(id)}/export`, { signal });
}

export async function notesByImage(sha256: string, signal?: AbortSignal): Promise<Note[]> {
  const res = await request<unknown>(`/notes/by-image/${encodeURIComponent(sha256)}`, { signal });
  return Array.isArray(res) ? (res as Note[]) : [];
}

// ---------------------------------------------------------------------------
// Collections — manual, ordered groups of images by sha256, proxied through
// the gateway /collections routes. Membership uses set/replace semantics: PUT
// /collections/{id}/images replaces the whole ordered list.
// ---------------------------------------------------------------------------

/** The writable fields of a collection on create (POST /collections). */
export interface CollectionUpsert {
  name: string;
  /** Ordered image refs by sha256. */
  images?: string[];
}

/** A persisted collection (id + name + ordered image refs). */
export interface Collection {
  id: string;
  name: string;
  images: string[];
}

export async function createCollection(body: CollectionUpsert, signal?: AbortSignal): Promise<Collection> {
  return request<Collection>("/collections", { method: "POST", body, signal });
}

export async function listCollections(signal?: AbortSignal): Promise<Collection[]> {
  const res = await request<unknown>("/collections", { signal });
  return Array.isArray(res) ? (res as Collection[]) : [];
}

export async function getCollection(id: string, signal?: AbortSignal): Promise<Collection> {
  return request<Collection>(`/collections/${encodeURIComponent(id)}`, { signal });
}

/** Rename a collection (PUT /collections/{id} with the new name). */
export async function renameCollection(id: string, name: string, signal?: AbortSignal): Promise<Collection> {
  return request<Collection>(`/collections/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { name },
    signal,
  });
}

export async function deleteCollection(id: string, signal?: AbortSignal): Promise<void> {
  await request<unknown>(`/collections/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}

/**
 * Replace a collection's ordered membership (PUT /collections/{id}/images).
 * Set semantics: `images` is the complete, ordered sha256 list — adds, removes,
 * and reorders are all expressed by sending the desired final list.
 */
export async function setCollectionImages(id: string, images: string[], signal?: AbortSignal): Promise<void> {
  await request<unknown>(`/collections/${encodeURIComponent(id)}/images`, {
    method: "PUT",
    body: { images },
    signal,
  });
}

export async function collectionsByImage(sha256: string, signal?: AbortSignal): Promise<Collection[]> {
  const res = await request<unknown>(`/collections/by-image/${encodeURIComponent(sha256)}`, { signal });
  return Array.isArray(res) ? (res as Collection[]) : [];
}

// ---------------------------------------------------------------------------
// MCP (JSON-RPC) — the gateway's only path for clusters/compare/related-tags/
// lineage/graph. Clusters & compare are STUBBED server-side (return
// { stubbed: true }); callers must handle that gracefully.
// ---------------------------------------------------------------------------

export interface McpToolCallResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Raw JSON-RPC pass-through (used by the /api/mcp proxy route). */
export async function mcpRpc(body: unknown, signal?: AbortSignal): Promise<unknown> {
  return request<unknown>("/mcp", { method: "POST", body, signal });
}

let mcpId = 0;

/** Call one MCP tool and return its structuredContent (or throw on tool error). */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpToolCallResult> {
  const body = {
    jsonrpc: "2.0",
    id: ++mcpId,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const res = (await mcpRpc(body, signal)) as {
    result?: McpToolCallResult;
    error?: { message?: string };
  };
  if (res?.error) throw new GatewayError(res.error.message ?? "mcp error", 502, res.error);
  return res?.result ?? {};
}

// ---------------------------------------------------------------------------
// Mappers — adapt gateway/downstream shapes to the UI shapes
// ---------------------------------------------------------------------------

/** Local proxy URL for an image's thumbnail bytes (served by /api/library). */
export function thumbnailUrl(sha256: string): string {
  return `/api/library/images/${sha256}/thumbnail`;
}

/** Local proxy URL for an image's full-resolution bytes. */
export function fileUrl(sha256: string): string {
  return `/api/library/images/${sha256}/file`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Build the one-line summary used on result cards from a search payload. */
function summarizePayload(payload: Record<string, unknown> | null | undefined, fallback: string): string {
  if (!payload) return fallback;
  const prompt = str(payload.prompt) ?? str(payload.summary);
  if (prompt) return prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  const tags = stringArray(payload.tags);
  if (tags.length) return tags.slice(0, 8).join(", ");
  return str(payload.filename) ?? fallback;
}

/** Map a deedlit.search hit (payload is the Qdrant payload) -> CompactResult. */
export function hitToCompactResult(hit: SearchHit): CompactResult {
  const p = hit.payload ?? {};
  return {
    imageId: hit.sha256,
    score: typeof hit.score === "number" ? hit.score : null,
    // Prefer a payload-provided URL; otherwise route bytes through the local proxy.
    thumbnailUrl:
      str(p.thumbnail_url) ?? str(p.thumbnailUrl) ?? thumbnailUrl(hit.sha256),
    summary: summarizePayload(p, hit.sha256),
    tags: stringArray(p.tags),
    model: str(p.model) ?? str(p.checkpoint),
    checkpoint: str(p.checkpoint),
    rating: typeof p.rating === "number" ? p.rating : null,
    // Content-safety class (catalog browse forwards the row's `safety`; the
    // vector path carries it in the Qdrant payload). null when unclassified.
    safety:
      p.safety === "sfw" || p.safety === "nsfw" || p.safety === "explicit" ? p.safety : null,
  };
}

export function hitsToCompactResults(hits: SearchHit[]): CompactResult[] {
  return hits.map(hitToCompactResult);
}

/**
 * Map a catalog Image record -> CompactResult for the browse grid. The catalog
 * browse path (filter + server sort + pagination) feeds the same card UI as the
 * vector search path, so the two converge on this shape. `score` is null (browse
 * has no relevance ranking); the summary mirrors {@link summarizePayload}.
 */
export function catalogImageToCompactResult(image: CatalogImage): CompactResult {
  const tags = stringArray(image.tags);
  const prompt = str(image.prompt);
  const filePath = str(image.filepath) ?? str(image.filePath) ?? str(image.file_path);
  const filename = filePath ? filePath.replace(/^.*[/\\]/, "") : null;
  const summary =
    (prompt ? prompt.replace(/\s+/g, " ").trim().slice(0, 140) : null) ??
    (tags.length ? tags.slice(0, 8).join(", ") : null) ??
    filename ??
    image.sha256;
  const checkpoint = refName(image, "checkpoint");
  return {
    imageId: image.sha256,
    score: null,
    thumbnailUrl: thumbnailUrl(image.sha256),
    summary,
    tags,
    model: checkpoint ?? str(image.model),
    checkpoint,
    rating: typeof image.rating === "number" ? image.rating : null,
    safety:
      image.safety === "sfw" || image.safety === "nsfw" || image.safety === "explicit"
        ? image.safety
        : null,
  };
}

/** First reference of a given kind (e.g. checkpoint). */
function refName(image: CatalogImage, kind: string): string | null {
  const ref = (image.references ?? []).find((r) => r.kind === kind);
  return ref ? ref.name : null;
}

function mapGenerationParams(image: CatalogImage): GenerationParams | null {
  const params = image.params;
  if (!params) return null;
  return {
    seed: params.seed ?? null,
    steps: params.steps ?? null,
    cfgScale: params.cfg ?? null,
    sampler: params.sampler ?? null,
    scheduler: params.scheduler ?? null,
    denoise: params.denoise ?? null,
    width: params.width ?? null,
    height: params.height ?? null,
    clipSkip: params.clipskip ?? null,
  };
}

function mapTags(image: CatalogImage): ImageTag[] {
  return (image.tags ?? []).map((t) => ({
    name: t,
    normalizedName: t,
    source: null,
  }));
}

function mapLoras(image: CatalogImage): LoraRef[] {
  return (image.references ?? [])
    .filter((r) => r.kind === "lora")
    .map((r) => ({ name: r.name, weight: null }));
}

/** Provider recorded by the catalog for the AI description (see catalog
 * repository ``_DESCRIPTION_PROVIDER``). The gateway forwards only the text, so
 * we attribute it to its single known producer here. */
const DESCRIPTION_PROVIDER = "deedlit.labelagent";

/**
 * Map the catalog's persisted AI description into the detail-page list shape.
 * The catalog keeps one current description per provider and the gateway
 * forwards it as a single ``description`` string, so this yields 0 or 1 entry.
 */
function mapDescriptions(image: CatalogImage): UiImageDetail["descriptions"] {
  const description = str(image.description);
  if (!description) return [];
  return [{ id: `${image.sha256}:${DESCRIPTION_PROVIDER}`, description, provider: DESCRIPTION_PROVIDER }];
}

/**
 * The shape the detail page (`app/library/[imageId]/page.tsx`) consumes. This
 * is intentionally a subset of the legacy ImageDetail — only the fields the UI
 * renders — built from the catalog Image record.
 */
export interface UiImageDetail {
  id: string;
  filename: string;
  filePath: string;
  prompt: string | null;
  negativePrompt: string | null;
  rating: number | null;
  favorite: boolean;
  model: string | null;
  checkpoint: string | null;
  modelFamily: string | null;
  width: number | null;
  height: number | null;
  sourceTool: string | null;
  tags: Array<{ name: string; normalizedName: string; source?: string | null }>;
  loras: LoraRef[];
  generationParams: GenerationParams | null;
  descriptions: Array<{ id: string; description: string; provider: string | null }>;
}

/** Map the catalog Image record -> the detail-page shape. */
export function imageToUiDetail(image: CatalogImage): UiImageDetail {
  const checkpoint = refName(image, "checkpoint");
  // The catalog serialises the originating on-disk path as `filepath` (one word);
  // keep the camel/snake fallbacks for any other producer. This is captured at
  // ingest and must never be dropped — it's how an image is traced back to source.
  const filePath = str(image.filepath) ?? str(image.filePath) ?? str(image.file_path) ?? "";
  const basename = filePath ? filePath.replace(/^.*[/\\]/, "") : null;
  return {
    id: image.sha256,
    filename: str(image.filename) ?? basename ?? `${image.sha256.slice(0, 12)}…`,
    filePath,
    prompt: image.prompt ?? null,
    negativePrompt: image.negative ?? null,
    rating: image.rating ?? null,
    favorite: Boolean(image.favorite),
    model: checkpoint ?? str(image.model),
    checkpoint,
    modelFamily: str(image.model_family) ?? str(image.modelFamily),
    width: image.width ?? image.params?.width ?? null,
    height: image.height ?? image.params?.height ?? null,
    sourceTool: image.sourceTool ?? null,
    tags: mapTags(image),
    loras: mapLoras(image),
    generationParams: mapGenerationParams(image),
    descriptions: mapDescriptions(image),
  };
}

/**
 * Build a relationship Graph (cytoscape shape) for the detail page from the
 * gateway's neighbor list. The gateway returns flat neighbors keyed by sha256;
 * we render the focus image at the centre with one edge per neighbor.
 */
export function neighborsToGraph(focusSha256: string, neighbors: GraphNeighbor[]): Graph {
  const nodes: Graph["nodes"] = [
    { id: focusSha256, label: focusSha256.slice(0, 8), type: "Image", properties: { seed: true, thumbnailUrl: thumbnailUrl(focusSha256) } },
  ];
  const edges: Graph["edges"] = [];
  for (const n of neighbors) {
    nodes.push({
      id: n.sha256,
      label: n.sha256.slice(0, 8),
      type: "Image",
      properties: { thumbnailUrl: thumbnailUrl(n.sha256) },
    });
    edges.push({ from: focusSha256, to: n.sha256, type: n.relation });
  }
  return { nodes, edges };
}

/**
 * Translate the legacy UI filter object (camelCase) into the flat filter the
 * gateway/search expects. Only includes keys with values.
 */
export function buildSearchFilter(filters: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!filters) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
