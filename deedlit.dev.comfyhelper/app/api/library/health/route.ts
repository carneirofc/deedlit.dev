import { handleRoute, jsonOk } from "@/lib/library/http";
import { pingPostgres } from "@/lib/library/db/postgres";
import { pingNeo4j } from "@/lib/library/db/neo4j";
import { pingQdrant } from "@/lib/library/db/qdrant";
import { isObjectStoreEnabled, pingObjectStore } from "@/lib/library/storage/object-store";
import { getEmbeddingDiagnostics, pingVisionApi } from "@/lib/library/services/embedding-service";
import { getCollectionInfo } from "@/lib/library/repositories/vector-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const objectStoreEnabled = isObjectStoreEnabled();
    const [postgres, neo4j, qdrant, objectStore, vision, collection] = await Promise.all([
      pingPostgres(),
      pingNeo4j(),
      pingQdrant(),
      objectStoreEnabled ? pingObjectStore() : Promise.resolve(true),
      pingVisionApi(),
      getCollectionInfo(),
    ]);
    // Object storage is optional; it only affects health when enabled.
    const healthy = postgres && neo4j && qdrant && objectStore;

    const embedder = getEmbeddingDiagnostics();
    const dimMatch =
      !collection.exists || collection.vectorSize === null || collection.vectorSize === embedder.dimensions;

    // Surface the exact reason similarity is "off" without 503-ing a working stack.
    const warnings: string[] = [];
    if (!embedder.hasExternalImageEmbeddings) {
      warnings.push(
        "CLIP_VISION_API_URL not set — deedlit.vision is required for embeddings (no local fallback). Ingest/search will error until it is configured.",
      );
    } else if (!vision.reachable) {
      warnings.push(
        `CLIP_VISION_API_URL is set (${vision.url}) but the vision API is unreachable${vision.detail ? ` — ${vision.detail}` : ""}. Ingests fail until it is up (no local fallback).`,
      );
    }
    if (collection.exists && !dimMatch) {
      warnings.push(
        `Qdrant collection is ${collection.vectorSize}-dim but the embedder is ${embedder.dimensions}-dim — rebuild Qdrant (POST /api/library/maintenance/rebuild-qdrant).`,
      );
    }
    if (vision.reachable && vision.expectedDim && vision.expectedDim !== embedder.dimensions) {
      warnings.push(
        `Vision model produces ${vision.expectedDim}-dim but EMBEDDING_DIMENSIONS=${embedder.dimensions} — set them equal and rebuild.`,
      );
    }

    return jsonOk(
      {
        healthy,
        services: {
          postgres,
          neo4j,
          qdrant,
          objectStore: objectStoreEnabled ? objectStore : "disabled",
        },
        embedding: {
          ...embedder,
          vision,
          collection,
          dimMatch,
        },
        warnings,
      },
      { status: healthy ? 200 : 503 },
    );
  });
}
