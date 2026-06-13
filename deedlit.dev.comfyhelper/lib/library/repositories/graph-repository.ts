import { runCypher } from "@/lib/library/db/neo4j";
import type { Graph, GraphScope } from "@/lib/library/schemas";

type GraphNode = Graph["nodes"][number];
type GraphEdge = Graph["edges"][number];

/**
 * Low-level Neo4j projection writes.  Neo4j is rebuildable from PostgreSQL; we
 * MERGE nodes/relationships so syncing the same image repeatedly is idempotent.
 */

export interface GraphImageInput {
  imageId: string;
  filename: string;
  thumbnailPath: string | null;
  rating: number | null;
  tags: string[];
  loras: string[];
  model: string | null;
  checkpoint: string | null;
  modelFamily: string | null;
  folder: string | null;
}

export async function upsertImageNode(input: GraphImageInput): Promise<void> {
  await runCypher(
    `MERGE (img:Image {id: $imageId})
       SET img.filename = $filename, img.thumbnailPath = $thumbnailPath, img.rating = $rating
     WITH img
     // Detach previous projection relationships so re-sync is clean.
     OPTIONAL MATCH (img)-[r:HAS_TAG|USES_LORA|USES_MODEL|USES_CHECKPOINT|IN_FOLDER]->()
     DELETE r
     WITH img
     FOREACH (tag IN $tags |
       MERGE (t:Tag {name: tag}) MERGE (img)-[:HAS_TAG]->(t))
     FOREACH (lora IN $loras |
       MERGE (l:LoRA {name: lora}) MERGE (img)-[:USES_LORA]->(l))
     FOREACH (_ IN CASE WHEN $model IS NULL THEN [] ELSE [1] END |
       MERGE (m:Model {name: $model}) MERGE (img)-[:USES_MODEL]->(m))
     FOREACH (_ IN CASE WHEN $checkpoint IS NULL THEN [] ELSE [1] END |
       MERGE (c:Checkpoint {name: $checkpoint}) MERGE (img)-[:USES_CHECKPOINT]->(c))
     FOREACH (_ IN CASE WHEN $folder IS NULL THEN [] ELSE [1] END |
       MERGE (f:Folder {path: $folder}) MERGE (img)-[:IN_FOLDER]->(f))`,
    {
      imageId: input.imageId,
      filename: input.filename,
      thumbnailPath: input.thumbnailPath,
      rating: input.rating,
      tags: input.tags,
      loras: input.loras,
      model: input.model,
      checkpoint: input.checkpoint,
      folder: input.folder,
    },
  );
}

export async function upsertLineageEdge(
  sourceId: string,
  derivedId: string,
  relationType: string,
): Promise<void> {
  const rel = relationType.toUpperCase();
  await runCypher(
    `MATCH (a:Image {id: $sourceId}) MATCH (b:Image {id: $derivedId})
     MERGE (b)-[:${rel}]->(a)`,
    { sourceId, derivedId },
  );
}

export async function clearGraph(): Promise<void> {
  await runCypher(`MATCH (n) DETACH DELETE n`);
}

/** Subgraph around an image up to `depth`, optionally restricted to rel types. */
export async function getImageSubgraph(
  imageId: string,
  depth: number,
  relationshipTypes: string[] | undefined,
): Promise<Graph> {
  const relFilter = relationshipTypes && relationshipTypes.length > 0
    ? `:${relationshipTypes.map((r) => r.toUpperCase()).join("|")}`
    : "";
  const result = await runCypher(
    `MATCH path = (img:Image {id: $imageId})-[${relFilter}*1..${depth}]-(other)
     WITH nodes(path) AS ns, relationships(path) AS rs
     UNWIND ns AS n
     WITH collect(DISTINCT n) AS nodes, rs
     UNWIND rs AS r
     WITH nodes, collect(DISTINCT r) AS rels
     RETURN nodes, rels`,
    { imageId },
    "READ",
  );

  const graph: Graph = { nodes: [], edges: [] };
  const seenNodes = new Set<string>();
  const record = result.records[0];
  if (!record) {
    return graph;
  }

  const nodes = record.get("nodes") as Array<{ identity: number | string; labels: string[]; properties: Record<string, unknown> }>;
  const rels = record.get("rels") as Array<{ type: string; start: number | string; end: number | string; properties: Record<string, unknown> }>;

  const idOf = (n: { identity: number | string; properties: Record<string, unknown> }) =>
    String(n.properties.id ?? n.properties.name ?? n.properties.path ?? n.identity);
  const internalToId = new Map<string, string>();

  for (const n of nodes) {
    const id = idOf(n);
    internalToId.set(String(n.identity), id);
    if (seenNodes.has(id)) continue;
    seenNodes.add(id);
    const label = String(n.properties.filename ?? n.properties.name ?? n.properties.path ?? id);
    graph.nodes.push({ id, label, type: n.labels[0] ?? "Node", properties: n.properties });
  }
  for (const r of rels) {
    const from = internalToId.get(String(r.start));
    const to = internalToId.get(String(r.end));
    if (from && to) {
      graph.edges.push({ from, to, type: r.type, properties: r.properties });
    }
  }
  return graph;
}

/** Property carrying a hub node's identifying value, per label. */
const HUB_PROP: Record<GraphNodeRefType, string> = {
  Tag: "name",
  Model: "name",
  Checkpoint: "name",
  LoRA: "name",
  Folder: "path",
};
type GraphNodeRefType = "Tag" | "Model" | "Checkpoint" | "LoRA" | "Folder";

/** Whitelist relationship types to safe Cypher identifiers (avoids injection). */
function relTypeFilter(types: string[] | undefined): string {
  if (!types || types.length === 0) return "";
  const safe = types
    .map((t) => t.toUpperCase().replace(/[^A-Z_]/g, ""))
    .filter(Boolean);
  return safe.length ? `:${safe.join("|")}` : "";
}

/**
 * Resolve a graph-relationship constraint to the set of image ids it allows.
 * Either scoped from a hub node (images directly attached to Tag/Model/…) or
 * from an image's neighbourhood (images sharing a hub with the seed image).
 * Labels come from a Zod enum so interpolating them is safe.
 */
export async function getConnectedImageIds(scope: GraphScope, limit: number): Promise<string[]> {
  const cap = Math.max(1, Math.floor(limit));
  const relFilter = relTypeFilter(scope.relationshipTypes);

  if (scope.node) {
    const prop = HUB_PROP[scope.node.type as GraphNodeRefType] ?? "name";
    const result = await runCypher(
      `MATCH (img:Image)-[r${relFilter}]->(n:${scope.node.type})
        WHERE n.${prop} = $value
        RETURN DISTINCT img.id AS id LIMIT ${cap}`,
      { value: scope.node.value },
      "READ",
    );
    return result.records.map((r) => String(r.get("id")));
  }

  if (scope.relatedToImageId) {
    const result = await runCypher(
      `MATCH (src:Image {id: $imageId})-[r1${relFilter}]->(hub)<-[r2${relFilter}]-(img:Image)
        WHERE img.id <> $imageId
        RETURN DISTINCT img.id AS id LIMIT ${cap}`,
      { imageId: scope.relatedToImageId },
      "READ",
    );
    return result.records.map((r) => String(r.get("id")));
  }

  return [];
}

/**
 * Union of each input image's subgraph, with non-image hub nodes that are
 * shared by more than one input flagged `shared:true`, and the input images
 * flagged `seed:true`.  Powers the comparison relationship view.
 */
export async function getCombinedSubgraph(imageIds: string[], depth: number): Promise<Graph> {
  const subgraphs = await Promise.all(
    imageIds.map((id) => getImageSubgraph(id, depth, undefined)),
  );

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  // For each non-image node, how many distinct input images reference it.
  const refs = new Map<string, Set<string>>();

  imageIds.forEach((seedId, i) => {
    const sg = subgraphs[i];
    for (const n of sg.nodes) {
      if (!nodes.has(n.id)) nodes.set(n.id, n);
      if (n.id !== seedId && n.type !== "Image") {
        let set = refs.get(n.id);
        if (!set) refs.set(n.id, (set = new Set()));
        set.add(seedId);
      }
    }
    for (const e of sg.edges) {
      edges.set(`${e.from}->${e.to}:${e.type}`, e);
    }
  });

  const inputSet = new Set(imageIds);
  const outNodes: GraphNode[] = Array.from(nodes.values()).map((n) => ({
    ...n,
    properties: {
      ...n.properties,
      ...(inputSet.has(n.id) ? { seed: true } : {}),
      ...((refs.get(n.id)?.size ?? 0) > 1 ? { shared: true } : {}),
    },
  }));

  return { nodes: outNodes, edges: Array.from(edges.values()) };
}
