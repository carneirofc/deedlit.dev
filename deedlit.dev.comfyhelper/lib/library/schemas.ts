import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical records
// ---------------------------------------------------------------------------

export const TagSourceSchema = z.enum([
  "prompt",
  "metadata",
  "manual",
  "auto_tagger",
  "external_vision_llm",
  "external_captioner",
]);
export type TagSource = z.infer<typeof TagSourceSchema>;

export const RelationTypeSchema = z.enum([
  "variant_of",
  "upscale_of",
  "inpaint_of",
  "edit_of",
  "same_prompt_as",
  "same_seed_as",
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const ImageTagSchema = z.object({
  name: z.string(),
  normalizedName: z.string(),
  category: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
});
export type ImageTag = z.infer<typeof ImageTagSchema>;

export const GenerationParamsSchema = z.object({
  seed: z.number().nullable().optional(),
  steps: z.number().nullable().optional(),
  cfgScale: z.number().nullable().optional(),
  sampler: z.string().nullable().optional(),
  scheduler: z.string().nullable().optional(),
  denoise: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  clipSkip: z.number().nullable().optional(),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

export const LoraRefSchema = z.object({
  name: z.string(),
  weight: z.number().nullable().optional(),
});
export type LoraRef = z.infer<typeof LoraRefSchema>;

export const ImageDetailSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  thumbnailPath: z.string().nullable(),
  filename: z.string(),
  extension: z.string().nullable(),
  sha256Hash: z.string(),
  perceptualHash: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fileSizeBytes: z.number().nullable(),
  createdAt: z.string().nullable(),
  importedAt: z.string(),
  modifiedAt: z.string().nullable(),
  sourceTool: z.string().nullable(),
  prompt: z.string().nullable(),
  negativePrompt: z.string().nullable(),
  rating: z.number().nullable(),
  favorite: z.boolean(),
  ingestionStatus: z.string(),
  model: z.string().nullable(),
  checkpoint: z.string().nullable(),
  modelFamily: z.string().nullable(),
  tags: z.array(ImageTagSchema),
  loras: z.array(LoraRefSchema),
  generationParams: GenerationParamsSchema.nullable(),
  descriptions: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ImageDetail = z.infer<typeof ImageDetailSchema>;

// Compact result row used in search / similarity responses.
// AI content-safety class (deedlit.labelagent). Drives the library safety filter.
export const SafetySchema = z.enum(["sfw", "nsfw", "explicit"]);
export type Safety = z.infer<typeof SafetySchema>;

export const CompactResultSchema = z.object({
  imageId: z.string(),
  score: z.number().nullable().optional(),
  thumbnailUrl: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  model: z.string().nullable().optional(),
  checkpoint: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  safety: SafetySchema.nullable().optional(),
});
export type CompactResult = z.infer<typeof CompactResultSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const SearchFiltersSchema = z.object({
  tags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
  modelFamily: z.string().optional(),
  checkpoint: z.string().optional(),
  loras: z.array(z.string()).optional(),
  ratingGte: z.number().int().min(0).max(5).optional(),
  favorite: z.boolean().optional(),
  sourceTool: z.string().optional(),
  // Content-safety classes to include. Omit/empty = no filter (show all).
  safety: z.array(SafetySchema).optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

/**
 * A graph-relationship constraint, resolved against Neo4j into a set of allowed
 * image ids.  Either scope from a hub node (e.g. all images sharing Model X) or
 * from an image's neighbourhood (images reachable within `hops`).
 */
export const GraphNodeRefSchema = z.object({
  type: z.enum(["Tag", "Model", "Checkpoint", "LoRA", "Folder"]),
  value: z.string().min(1),
});
export type GraphNodeRef = z.infer<typeof GraphNodeRefSchema>;

export const GraphScopeSchema = z.object({
  relatedToImageId: z.string().optional(),
  node: GraphNodeRefSchema.optional(),
  relationshipTypes: z.array(z.string()).optional(),
  hops: z.number().int().min(1).max(3).default(1),
});
export type GraphScope = z.infer<typeof GraphScopeSchema>;

export const MetadataSearchRequestSchema = z.object({
  query: z.string().optional(),
  ...SearchFiltersSchema.shape,
  graphScope: GraphScopeSchema.optional(),
  limit: z.number().int().min(1).max(200).default(30),
  offset: z.number().int().min(0).default(0),
});
export type MetadataSearchRequest = z.infer<typeof MetadataSearchRequestSchema>;

export const SemanticSearchRequestSchema = z.object({
  query: z.string().min(1),
  filters: SearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(200).default(30),
  /** Drop vector hits scoring below this cosine threshold (0 = no cutoff). */
  minScore: z.number().min(0).max(1).default(0),
});
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;

export const SimilarSearchRequestSchema = z.object({
  imageId: z.string().min(1),
  filters: SearchFiltersSchema.optional(),
  graphScope: GraphScopeSchema.optional(),
  limit: z.number().int().min(1).max(200).default(30),
  minScore: z.number().min(0).max(1).default(0),
  /** HNSW search beam width — raise for recall on larger collections. */
  hnswEf: z.number().int().min(4).max(1024).optional(),
  /** Exact brute-force scan (slow) for ground-truth comparison. */
  exact: z.boolean().optional(),
});
export type SimilarSearchRequest = z.infer<typeof SimilarSearchRequestSchema>;

/**
 * Options for reverse-image search.  The image itself arrives as multipart
 * form-data (`file` field); these JSON options ride alongside in `options`.
 */
export const ImageSearchOptionsSchema = z.object({
  filters: SearchFiltersSchema.optional(),
  graphScope: GraphScopeSchema.optional(),
  limit: z.number().int().min(1).max(200).default(30),
  minScore: z.number().min(0).max(1).default(0),
});
export type ImageSearchOptions = z.infer<typeof ImageSearchOptionsSchema>;

export const IngestFolderRequestSchema = z.object({
  folderPath: z.string().min(1),
  recursive: z.boolean().default(true),
  generateThumbnails: z.boolean().default(true),
  extractMetadata: z.boolean().default(true),
  runExternalEnrichment: z.boolean().default(false),
  indexQdrant: z.boolean().default(true),
  syncNeo4j: z.boolean().default(true),
});
export type IngestFolderRequest = z.infer<typeof IngestFolderRequestSchema>;

export const GraphRequestSchema = z.object({
  depth: z.number().int().min(1).max(4).default(1),
  relationshipTypes: z.array(z.string()).optional(),
});
export type GraphRequest = z.infer<typeof GraphRequestSchema>;

export const ReindexRequestSchema = z.object({
  imageId: z.string().min(1),
  refreshMetadata: z.boolean().default(true),
  refreshGraph: z.boolean().default(true),
  refreshQdrant: z.boolean().default(true),
  runExternalEnrichment: z.boolean().default(false),
});
export type ReindexRequest = z.infer<typeof ReindexRequestSchema>;

export const EnrichRequestSchema = z.object({
  imageId: z.string().min(1),
  mode: z.enum(["short_caption", "full_description", "tags", "all"]).default("all"),
});
export type EnrichRequest = z.infer<typeof EnrichRequestSchema>;

// ---------------------------------------------------------------------------
// Graph payloads
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type Graph = z.infer<typeof GraphSchema>;

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export const CompareRequestSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(2).max(4),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

/** One image in a comparison, flattened to the fields the diff table shows. */
export const CompareImageSchema = z.object({
  id: z.string(),
  filename: z.string(),
  thumbnailUrl: z.string(),
  imageUrl: z.string(),
  prompt: z.string().nullable(),
  negativePrompt: z.string().nullable(),
  model: z.string().nullable(),
  checkpoint: z.string().nullable(),
  modelFamily: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  rating: z.number().nullable(),
  favorite: z.boolean(),
  sourceTool: z.string().nullable(),
  folder: z.string().nullable(),
  tags: z.array(z.string()),
  loras: z.array(LoraRefSchema),
  generationParams: GenerationParamsSchema.nullable(),
});
export type CompareImage = z.infer<typeof CompareImageSchema>;

export const PairwiseSimilaritySchema = z.object({
  a: z.string(),
  b: z.string(),
  score: z.number(),
});
export type PairwiseSimilarity = z.infer<typeof PairwiseSimilaritySchema>;

/** A single row of the comparison diff table. */
export const CompareFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  values: z.array(z.string().nullable()),
  allEqual: z.boolean(),
});
export type CompareField = z.infer<typeof CompareFieldSchema>;

export const CompareResultSchema = z.object({
  images: z.array(CompareImageSchema),
  fields: z.array(CompareFieldSchema),
  sharedTags: z.array(z.string()),
  uniqueTags: z.array(z.array(z.string())),
  pairwiseSimilarity: z.array(PairwiseSimilaritySchema),
  similarityAvailable: z.boolean(),
  graph: GraphSchema,
});
export type CompareResult = z.infer<typeof CompareResultSchema>;

// ---------------------------------------------------------------------------
// Cluster exploration
// ---------------------------------------------------------------------------

export const ClusterRequestSchema = z.object({
  filters: SearchFiltersSchema.optional(),
  graphScope: GraphScopeSchema.optional(),
  /** How many points to sample from the (filtered) collection. */
  sample: z.number().int().min(50).max(2000).default(400),
  /** Neighbours per sampled point used to build the similarity graph. */
  neighbors: z.number().int().min(2).max(20).default(6),
  /** Minimum similarity for an edge to be kept. */
  threshold: z.number().min(0).max(1).default(0.6),
  /** Louvain resolution — higher yields more, smaller communities. */
  resolution: z.number().min(0.1).max(5).default(1),
});
export type ClusterRequest = z.infer<typeof ClusterRequestSchema>;

export const ClusterSummarySchema = z.object({
  id: z.number().int(),
  label: z.string(),
  size: z.number().int(),
  representativeImageId: z.string(),
  imageIds: z.array(z.string()),
  topTags: z.array(z.string()),
});
export type ClusterSummary = z.infer<typeof ClusterSummarySchema>;

export const ClusterResultSchema = z.object({
  clusters: z.array(ClusterSummarySchema),
  graph: GraphSchema,
  sampled: z.number().int(),
  edges: z.number().int(),
});
export type ClusterResult = z.infer<typeof ClusterResultSchema>;
