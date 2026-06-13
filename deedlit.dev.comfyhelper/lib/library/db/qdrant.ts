import { QdrantClient } from "@qdrant/js-client-rest";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";

const logger = getLogger({ scope: "library-qdrant" });

declare global {
  var __comfyhelperQdrantClient: QdrantClient | undefined;
}

/**
 * Shared Qdrant client.  Qdrant is a rebuildable projection of the canonical
 * PostgreSQL data — it stores image embeddings for similarity / near-duplicate
 * / natural-language search.
 */
export function getQdrant(): QdrantClient {
  if (!globalThis.__comfyhelperQdrantClient) {
    const { qdrantUrl, qdrantApiKey } = getLibraryConfig();
    globalThis.__comfyhelperQdrantClient = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });
  }
  return globalThis.__comfyhelperQdrantClient;
}

export async function pingQdrant(): Promise<boolean> {
  try {
    await getQdrant().getCollections();
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Qdrant ping failed");
    return false;
  }
}
