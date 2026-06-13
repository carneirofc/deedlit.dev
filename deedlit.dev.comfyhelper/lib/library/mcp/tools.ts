import { z, type ZodType } from "zod";

import { ensureLibrarySchema } from "@/lib/library/db/migrate";
import { getImageDetail } from "@/lib/library/repositories/image-repository";
import {
  findSimilarImages,
  hybridSearch,
  searchImagesByMetadata,
  semanticImageSearch,
} from "@/lib/library/services/search-service";
import { findImageLineage, findRelatedTags, getImageGraph } from "@/lib/library/services/graph-service";
import { enrichImageMetadata, shouldRunVisionEnrichment } from "@/lib/library/services/enrichment-service";
import { reindexImage, startIngestion } from "@/lib/library/services/ingest-service";
import { compareImages } from "@/lib/library/services/compare-service";
import { buildClusters } from "@/lib/library/services/cluster-service";
import type { SearchFilters } from "@/lib/library/schemas";

export interface McpTool<TInput = unknown> {
  name: string;
  description: string;
  schema: ZodType<TInput>;
  handler: (input: TInput) => Promise<unknown>;
}

function pickFilters(input: {
  tags?: string[];
  exclude_tags?: string[];
  model_family?: string;
  checkpoint?: string;
  loras?: string[];
  rating_gte?: number;
  favorite?: boolean;
}): SearchFilters {
  return {
    tags: input.tags,
    excludeTags: input.exclude_tags,
    modelFamily: input.model_family,
    checkpoint: input.checkpoint,
    loras: input.loras,
    ratingGte: input.rating_gte,
    favorite: input.favorite,
  };
}

const SearchImagesInput = z.object({
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  exclude_tags: z.array(z.string()).optional(),
  model_family: z.string().optional(),
  checkpoint: z.string().optional(),
  loras: z.array(z.string()).optional(),
  rating_gte: z.number().int().min(0).max(5).optional(),
  favorite: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(30),
});

const SemanticInput = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      tags: z.array(z.string()).optional(),
      exclude_tags: z.array(z.string()).optional(),
      model_family: z.string().optional(),
      checkpoint: z.string().optional(),
      loras: z.array(z.string()).optional(),
      rating_gte: z.number().int().min(0).max(5).optional(),
      favorite: z.boolean().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).default(30),
});

const SimilarInput = z.object({
  image_id: z.string().min(1),
  filters: SemanticInput.shape.filters,
  limit: z.number().int().min(1).max(200).default(30),
});

const ImageIdInput = z.object({ image_id: z.string().min(1) });

const CompareInput = z.object({
  image_ids: z.array(z.string().min(1)).min(2).max(4),
});

const ClusterInput = z.object({
  filters: SemanticInput.shape.filters,
  sample: z.number().int().min(50).max(2000).default(400),
  neighbors: z.number().int().min(2).max(20).default(6),
  threshold: z.number().min(0).max(1).default(0.6),
  resolution: z.number().min(0.1).max(5).default(1),
});

const GraphInput = z.object({
  image_id: z.string().min(1),
  depth: z.number().int().min(1).max(4).default(1),
  relationship_types: z.array(z.string()).optional(),
});

const RelatedTagsInput = z.object({
  tag: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

const DescribeInput = z.object({
  image_id: z.string().min(1),
  mode: z.enum(["short_caption", "full_description", "tags", "all"]).default("all"),
});

const IngestInput = z.object({
  folder_path: z.string().min(1),
  recursive: z.boolean().default(true),
  run_external_enrichment: z.boolean().default(false),
  generate_embeddings: z.boolean().default(true),
  generate_thumbnails: z.boolean().default(true),
});

const ReindexInput = z.object({
  image_id: z.string().min(1),
  refresh_metadata: z.boolean().default(true),
  refresh_graph: z.boolean().default(true),
  refresh_qdrant: z.boolean().default(true),
  run_external_enrichment: z.boolean().default(false),
});

export const MCP_TOOLS: McpTool[] = [
  {
    name: "search_images",
    description: "General metadata / hybrid image search across the library.",
    schema: SearchImagesInput,
    handler: async (raw) => {
      const input = SearchImagesInput.parse(raw);
      await ensureLibrarySchema();
      const filters = pickFilters(input);
      const results = input.query
        ? await hybridSearch(input.query, filters, input.limit)
        : await searchImagesByMetadata({ ...filters }, input.limit);
      return { results };
    },
  },
  {
    name: "semantic_image_search",
    description: "Natural-language image search (Qdrant when a semantic embedding provider is configured, else metadata fallback).",
    schema: SemanticInput,
    handler: async (raw) => {
      const input = SemanticInput.parse(raw);
      await ensureLibrarySchema();
      const results = await semanticImageSearch(input.query, input.filters ? pickFilters(input.filters) : undefined, input.limit);
      return { results };
    },
  },
  {
    name: "find_similar_images",
    description: "Find images visually similar to a selected image.",
    schema: SimilarInput,
    handler: async (raw) => {
      const input = SimilarInput.parse(raw);
      await ensureLibrarySchema();
      const results = await findSimilarImages(input.image_id, input.filters ? pickFilters(input.filters) : undefined, input.limit);
      return { results };
    },
  },
  {
    name: "compare_images",
    description: "Compare 2-4 images: per-field metadata diff, shared/unique tags, pairwise embedding similarity, and the combined relationship graph.",
    schema: CompareInput,
    handler: async (raw) => {
      const input = CompareInput.parse(raw);
      await ensureLibrarySchema();
      return compareImages(input.image_ids);
    },
  },
  {
    name: "find_image_clusters",
    description: "Cluster the library (or a filtered subset) by embedding similarity using the Qdrant distance matrix + Louvain community detection.",
    schema: ClusterInput,
    handler: async (raw) => {
      const input = ClusterInput.parse(raw);
      await ensureLibrarySchema();
      return buildClusters({
        filters: input.filters ? pickFilters(input.filters) : undefined,
        sample: input.sample,
        neighbors: input.neighbors,
        threshold: input.threshold,
        resolution: input.resolution,
      });
    },
  },
  {
    name: "get_image_details",
    description: "Return complete canonical metadata for an image.",
    schema: ImageIdInput,
    handler: async (raw) => {
      const input = ImageIdInput.parse(raw);
      await ensureLibrarySchema();
      const detail = await getImageDetail(input.image_id);
      if (!detail) throw new Error(`image not found: ${input.image_id}`);
      return detail;
    },
  },
  {
    name: "get_image_graph",
    description: "Return the relationship graph around an image (tags, models, loras, lineage).",
    schema: GraphInput,
    handler: async (raw) => {
      const input = GraphInput.parse(raw);
      return getImageGraph(input.image_id, input.depth, input.relationship_types);
    },
  },
  {
    name: "find_related_tags",
    description: "Find tags related to a tag via co-occurrence.",
    schema: RelatedTagsInput,
    handler: async (raw) => {
      const input = RelatedTagsInput.parse(raw);
      await ensureLibrarySchema();
      return { tag: input.tag, related: await findRelatedTags(input.tag, input.limit) };
    },
  },
  {
    name: "find_image_lineage",
    description: "Return original / variant / upscale / inpaint relationships for an image.",
    schema: ImageIdInput,
    handler: async (raw) => {
      const input = ImageIdInput.parse(raw);
      await ensureLibrarySchema();
      return findImageLineage(input.image_id);
    },
  },
  {
    name: "describe_image_optional",
    description: "Trigger optional external vision/LLM description for an image. Only works when ENABLE_EXTERNAL_VISION_ENRICHMENT=true.",
    schema: DescribeInput,
    handler: async (raw) => {
      const input = DescribeInput.parse(raw);
      if (!shouldRunVisionEnrichment()) {
        throw new Error("external vision enrichment is disabled (set ENABLE_EXTERNAL_VISION_ENRICHMENT=true)");
      }
      await ensureLibrarySchema();
      const result = await enrichImageMetadata(input.image_id);
      return { imageId: input.image_id, mode: input.mode, result };
    },
  },
  {
    name: "ingest_folder",
    description: "Trigger ingestion of a local folder. Returns a job id immediately.",
    schema: IngestInput,
    handler: async (raw) => {
      const input = IngestInput.parse(raw);
      const jobId = await startIngestion({
        folderPath: input.folder_path,
        recursive: input.recursive,
        generateThumbnails: input.generate_thumbnails,
        extractMetadata: true,
        runExternalEnrichment: input.run_external_enrichment,
        indexQdrant: input.generate_embeddings,
        syncNeo4j: true,
      });
      return { job_id: jobId, status: "started" };
    },
  },
  {
    name: "reindex_image",
    description: "Re-extract metadata and refresh graph/vector indexes for an image.",
    schema: ReindexInput,
    handler: async (raw) => {
      const input = ReindexInput.parse(raw);
      await ensureLibrarySchema();
      const result = await reindexImage({
        imageId: input.image_id,
        refreshMetadata: input.refresh_metadata,
        refreshGraph: input.refresh_graph,
        refreshQdrant: input.refresh_qdrant,
        runExternalEnrichment: input.run_external_enrichment,
      });
      if (!result) throw new Error(`image not found: ${input.image_id}`);
      return result;
    },
  },
];

export function getToolByName(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
