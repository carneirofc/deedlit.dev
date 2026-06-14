import { test, expect } from "@playwright/test";

import {
  buildSearchFilter,
  getGatewayBaseUrl,
  getDetail,
  hitToCompactResult,
  hitsToCompactResults,
  imageToUiDetail,
  neighborsToGraph,
  search,
  thumbnailUrl,
  type CatalogImage,
  type SearchHit,
} from "../../lib/api-client";

// ---------------------------------------------------------------------------
// Test harness: stub global.fetch + drive base URL via env.
// ---------------------------------------------------------------------------

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;

function stubFetch(stub: FetchStub) {
  globalThis.fetch = stub as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withBase(url: string | undefined, fn: () => Promise<void> | void) {
  const prevServer = process.env.DEEDLIT_API_URL;
  const prevPub = process.env.NEXT_PUBLIC_DEEDLIT_API_URL;
  if (url === undefined) delete process.env.DEEDLIT_API_URL;
  else process.env.DEEDLIT_API_URL = url;
  delete process.env.NEXT_PUBLIC_DEEDLIT_API_URL;
  const restore = () => {
    if (prevServer === undefined) delete process.env.DEEDLIT_API_URL;
    else process.env.DEEDLIT_API_URL = prevServer;
    if (prevPub === undefined) delete process.env.NEXT_PUBLIC_DEEDLIT_API_URL;
    else process.env.NEXT_PUBLIC_DEEDLIT_API_URL = prevPub;
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return result;
}

// ---------------------------------------------------------------------------
// Base URL resolution
// ---------------------------------------------------------------------------

test("base URL defaults to localhost:8088 and strips trailing slashes", () => {
  withBase("http://gw.test:9000/", () => {
    expect(getGatewayBaseUrl()).toBe("http://gw.test:9000");
  });
  withBase(undefined, () => {
    expect(getGatewayBaseUrl()).toBe("http://localhost:8088");
  });
});

// ---------------------------------------------------------------------------
// POST /search mapping (library + semantic)
// ---------------------------------------------------------------------------

test("search() POSTs to the gateway /search and maps hits to CompactResult", async () => {
  await withBase("http://gw.test:8080", async () => {
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let sentBody: unknown;
    stubFetch(async (input, init) => {
      calledUrl = input.toString();
      calledMethod = init?.method;
      sentBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse({
        fusion: "rrf",
        hits: [
          {
            sha256: "a".repeat(64),
            score: 0.91,
            payload: {
              prompt: "a   castle   at dusk",
              tags: ["castle", "dusk"],
              checkpoint: "sdxl_base",
              thumbnail_url: "http://cdn/thumb.webp",
            },
          },
          { sha256: "b".repeat(64), score: 0.42, payload: null },
        ],
      });
    });
    try {
      const res = await search({ query: "castle", limit: 24, filter: { tags: ["castle"] } });
      expect(calledUrl).toBe("http://gw.test:8080/search");
      expect(calledMethod).toBe("POST");
      expect(sentBody).toEqual({ query: "castle", limit: 24, filter: { tags: ["castle"] } });

      const results = hitsToCompactResults(res.hits);
      expect(results).toHaveLength(2);
      // payload-provided thumbnail wins; prompt collapses whitespace.
      expect(results[0]).toMatchObject({
        imageId: "a".repeat(64),
        score: 0.91,
        thumbnailUrl: "http://cdn/thumb.webp",
        summary: "a castle at dusk",
        tags: ["castle", "dusk"],
        checkpoint: "sdxl_base",
        model: "sdxl_base",
      });
      // no payload -> local thumbnail proxy + sha as summary fallback.
      expect(results[1].thumbnailUrl).toBe(thumbnailUrl("b".repeat(64)));
      expect(results[1].summary).toBe("b".repeat(64));
      expect(results[1].tags).toEqual([]);
    } finally {
      restoreFetch();
    }
  });
});

test("search() tolerates a missing/!ok hits array", async () => {
  await withBase("http://gw.test:8080", async () => {
    stubFetch(async () => jsonResponse({}));
    try {
      const res = await search({ query: "x" });
      expect(res.hits).toEqual([]);
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /detail mapping
// ---------------------------------------------------------------------------

test("getDetail() GETs /detail/{sha} and image maps to the UI detail shape", async () => {
  await withBase("http://gw.test:8080", async () => {
    const sha = "c".repeat(64);
    const image: CatalogImage = {
      sha256: sha,
      prompt: "portrait",
      negative: "blurry",
      width: 1024,
      height: 1536,
      sourceTool: "comfyui",
      rating: 4,
      favorite: true,
      tags: ["portrait", "studio"],
      params: { seed: 7, steps: 30, cfg: 6.5, sampler: "euler", clipskip: 2, width: 1024, height: 1536 },
      references: [
        { kind: "checkpoint", name: "sdxl_base.safetensors", hash: null },
        { kind: "lora", name: "detail.safetensors", hash: null },
      ],
    };
    let calledUrl: string | undefined;
    stubFetch(async (input) => {
      calledUrl = input.toString();
      return jsonResponse({ image, similar: [], neighbors: [] });
    });
    try {
      const detail = await getDetail(sha);
      expect(calledUrl).toBe(`http://gw.test:8080/detail/${sha}`);

      const ui = imageToUiDetail(detail.image);
      expect(ui).toMatchObject({
        id: sha,
        prompt: "portrait",
        negativePrompt: "blurry", // negative -> negativePrompt
        rating: 4,
        favorite: true,
        sourceTool: "comfyui",
        checkpoint: "sdxl_base.safetensors",
        model: "sdxl_base.safetensors", // falls back to checkpoint
        width: 1024,
        height: 1536,
      });
      // params: cfg -> cfgScale, clipskip -> clipSkip
      expect(ui.generationParams).toMatchObject({ cfgScale: 6.5, clipSkip: 2, seed: 7, steps: 30 });
      // tags: string[] -> {name, normalizedName}
      expect(ui.tags).toEqual([
        { name: "portrait", normalizedName: "portrait", source: null },
        { name: "studio", normalizedName: "studio", source: null },
      ]);
      // loras pulled from references
      expect(ui.loras).toEqual([{ name: "detail.safetensors", weight: null }]);
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Single-hit + filter + neighbors mappers
// ---------------------------------------------------------------------------

test("hitToCompactResult prefers tags summary when no prompt, else filename", () => {
  const tagged: SearchHit = { sha256: "d".repeat(64), score: 0.5, payload: { tags: ["x", "y"] } };
  expect(hitToCompactResult(tagged).summary).toBe("x, y");

  const named: SearchHit = { sha256: "e".repeat(64), score: 0.5, payload: { filename: "pic.png" } };
  expect(hitToCompactResult(named).summary).toBe("pic.png");
});

test("hitToCompactResult maps the content-safety class (null when absent/invalid)", () => {
  const explicit: SearchHit = { sha256: "a".repeat(64), score: 0.1, payload: { safety: "explicit" } };
  expect(hitToCompactResult(explicit).safety).toBe("explicit");
  const bogus: SearchHit = { sha256: "b".repeat(64), score: 0.1, payload: { safety: "weird" } };
  expect(hitToCompactResult(bogus).safety).toBeNull();
  const none: SearchHit = { sha256: "c".repeat(64), score: 0.1, payload: {} };
  expect(hitToCompactResult(none).safety).toBeNull();
});

test("buildSearchFilter keeps a non-empty safety array and drops an empty one", () => {
  expect(buildSearchFilter({ safety: ["sfw", "nsfw"] })).toEqual({ safety: ["sfw", "nsfw"] });
  expect(buildSearchFilter({ safety: [] })).toBeNull();
});

test("buildSearchFilter drops empty/undefined values and returns null when empty", () => {
  expect(buildSearchFilter(undefined)).toBeNull();
  expect(buildSearchFilter({ tags: [], modelFamily: "", checkpoint: undefined })).toBeNull();
  expect(buildSearchFilter({ tags: ["a"], favorite: true, checkpoint: "" })).toEqual({
    tags: ["a"],
    favorite: true,
  });
});

test("neighborsToGraph centres the focus image with one edge per neighbor", () => {
  const focus = "f".repeat(64);
  const graph = neighborsToGraph(focus, [
    { sha256: "0".repeat(64), relation: "shared_asset", weight: 2 },
    { sha256: "1".repeat(64), relation: "tag_cooccurrence" },
  ]);
  expect(graph.nodes).toHaveLength(3);
  expect(graph.nodes[0]).toMatchObject({ id: focus, type: "Image" });
  expect(graph.nodes[0].properties?.seed).toBe(true);
  expect(graph.edges).toEqual([
    { from: focus, to: "0".repeat(64), type: "shared_asset" },
    { from: focus, to: "1".repeat(64), type: "tag_cooccurrence" },
  ]);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test("getDetail surfaces a 404 as a GatewayError with status 404", async () => {
  await withBase("http://gw.test:8080", async () => {
    stubFetch(async () => jsonResponse({ detail: "image not found" }, 404));
    try {
      await expect(getDetail("9".repeat(64))).rejects.toMatchObject({ status: 404 });
    } finally {
      restoreFetch();
    }
  });
});
