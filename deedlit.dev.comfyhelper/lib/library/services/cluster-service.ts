import Graphology from "graphology";
import louvain from "graphology-communities-louvain";

import { getLogger } from "@/lib/logger";
import { getListItemsByIds } from "@/lib/library/repositories/image-repository";
import {
  searchSimilarityMatrix,
  type SimilarityMatrix,
} from "@/lib/library/repositories/vector-repository";
import { buildQdrantFilter, ensureImagesCollection } from "@/lib/library/services/qdrant-service";
import { resolveGraphScope } from "@/lib/library/services/graph-service";
import type { ClusterRequest, ClusterResult, ClusterSummary } from "@/lib/library/schemas";

const logger = getLogger({ scope: "library-cluster-service" });

const EMPTY: ClusterResult = { clusters: [], graph: { nodes: [], edges: [] }, sampled: 0, edges: 0 };

/**
 * Build clusters of visually similar images:
 *   1. resolve any Neo4j graph scope → allowed id set (the "graph filter"),
 *   2. ask Qdrant for a sparse kNN similarity matrix over a sampled subset,
 *   3. build an undirected weighted graph of edges above `threshold`,
 *   4. run Louvain community detection (graphology),
 *   5. hydrate clusters (representative + top tags) and return a graph payload
 *      whose nodes carry their cluster id for the cytoscape view.
 */
export async function buildClusters(req: ClusterRequest): Promise<ClusterResult> {
  await ensureImagesCollection();

  const allowed = await resolveGraphScope(req.graphScope);
  if (allowed !== null && allowed.length === 0) return EMPTY;

  const filter = buildQdrantFilter(req.filters, allowed ?? undefined);

  let matrix: SimilarityMatrix;
  try {
    matrix = await searchSimilarityMatrix(filter, req.sample, req.neighbors);
  } catch (error) {
    logger.warn({ err: error }, "buildClusters: similarity matrix unavailable");
    return EMPTY;
  }
  if (matrix.ids.length === 0) return EMPTY;

  // Undirected weighted similarity graph (nodes added lazily via edges so the
  // result stays focused on actually-connected images).
  const g = new Graphology({ type: "undirected" });
  let keptEdges = 0;
  for (const { a, b, score } of matrix.pairs) {
    if (score < req.threshold || a === b) continue;
    if (!g.hasNode(a)) g.addNode(a);
    if (!g.hasNode(b)) g.addNode(b);
    if (g.hasEdge(a, b)) {
      const w = g.getEdgeAttribute(a, b, "weight") as number;
      if (score > w) g.setEdgeAttribute(a, b, "weight", score);
    } else {
      g.addEdge(a, b, { weight: score });
      keptEdges++;
    }
  }
  if (g.order === 0) {
    return { ...EMPTY, sampled: matrix.ids.length };
  }

  // Community detection.
  const communities = louvain(g, { resolution: req.resolution, getEdgeWeight: "weight" });

  // Group nodes by community; keep groups of >= 2, largest first, renumbered.
  const byCommunity = new Map<number, string[]>();
  for (const [node, c] of Object.entries(communities)) {
    let members = byCommunity.get(c);
    if (!members) byCommunity.set(c, (members = []));
    members.push(node);
  }
  const clusterGroups = Array.from(byCommunity.values())
    .filter((m) => m.length >= 2)
    .sort((a, b) => b.length - a.length);

  const clusterOf = new Map<string, number>();
  clusterGroups.forEach((members, idx) => members.forEach((m) => clusterOf.set(m, idx)));

  const itemMap = await getListItemsByIds(g.nodes());

  const clusters: ClusterSummary[] = clusterGroups.map((members, idx) => {
    let representativeImageId = members[0];
    let bestDegree = -1;
    const tagFreq = new Map<string, number>();
    for (const m of members) {
      const degree = g.degree(m);
      if (degree > bestDegree) {
        bestDegree = degree;
        representativeImageId = m;
      }
      const item = itemMap.get(m);
      if (item) for (const t of item.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    }
    const topTags = Array.from(tagFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
    return {
      id: idx,
      label: topTags[0] ?? `Cluster ${idx + 1}`,
      size: members.length,
      representativeImageId,
      imageIds: members,
      topTags,
    };
  });

  const nodes = g.nodes().map((id) => {
    const item = itemMap.get(id);
    return {
      id,
      label: item?.filename ?? id,
      type: "Image",
      properties: {
        cluster: clusterOf.has(id) ? (clusterOf.get(id) as number) : -1,
        thumbnailUrl: `/api/library/images/${id}/thumbnail`,
        rating: item?.rating ?? null,
      },
    };
  });

  const edges = g.mapEdges((_edge, attr, source, target) => ({
    from: source,
    to: target,
    type: "SIMILAR",
    properties: { weight: attr.weight as number },
  }));

  return { clusters, graph: { nodes, edges }, sampled: matrix.ids.length, edges: keptEdges };
}
