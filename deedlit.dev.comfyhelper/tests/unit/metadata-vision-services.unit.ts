import { test, expect } from "@playwright/test";

import { resetLibraryConfigCache } from "../../lib/library/config";
import {
  extractMetadataFromBuffer,
  MetadataServiceNotConfiguredError,
} from "../../lib/library/services/metadata-client";
import { mapExtractResult } from "../../lib/library/services/metadata-service";
import {
  generateImageEmbedding,
  generateImageEmbeddingFromBuffer,
  generateTextEmbedding,
  VisionServiceNotConfiguredError,
} from "../../lib/library/services/embedding-service";

// ---------------------------------------------------------------------------
// Test harness: stub global.fetch + drive config via env, resetting both.
// ---------------------------------------------------------------------------

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetLibraryConfigCache();
  const restore = () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetLibraryConfigCache();
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return result;
}

function stubFetch(stub: FetchStub) {
  globalThis.fetch = stub as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

// A1111 ExtractResult as the deedlit.metadata service would return it.
const A1111_EXTRACT = {
  sourceTool: "a1111" as const,
  prompt: "masterpiece, 1girl, blue eyes",
  negative: "lowres, bad anatomy",
  tags: ["masterpiece", "1girl", "blue eyes"],
  params: {
    seed: 1234567890,
    steps: 28,
    cfg: 7.5,
    sampler: "DPM++ 2M Karras",
    scheduler: null,
    denoise: null,
    clipskip: null,
    width: 512,
    height: 768,
  },
  references: { checkpoints: [], loras: [], embeddings: [], vae: [], controlnets: [], upscalers: [] },
  workflow_json: null,
  api_prompt_json: null,
};

// ComfyUI ExtractResult.
const COMFY_EXTRACT = {
  sourceTool: "comfyui" as const,
  prompt: "a photo of <lora:detail:0.8> a castle",
  negative: "blurry",
  tags: ["a photo of", "a castle"],
  params: {
    seed: 42,
    steps: 20,
    cfg: 6,
    sampler: "euler",
    scheduler: "normal",
    denoise: 1,
    clipskip: null,
    width: 1024,
    height: 1024,
  },
  references: {
    checkpoints: [{ name: "sdxl_base.safetensors", hash: null }],
    loras: [],
    embeddings: [],
    vae: [],
    controlnets: [],
    upscalers: [],
  },
  workflow_json: { nodes: [{ id: 1 }] },
  api_prompt_json: { "1": { class_type: "KSampler" } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Metadata HTTP client → POST /extract
// ---------------------------------------------------------------------------

test("metadata client POSTs multipart to METADATA_API_URL/extract", async () => {
  await withEnv({ METADATA_API_URL: "http://metadata.test:8005" }, async () => {
    let calledUrl: string | undefined;
    let method: string | undefined;
    stubFetch(async (input, init) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      method = init?.method;
      expect(init?.body).toBeInstanceOf(FormData);
      return jsonResponse(A1111_EXTRACT);
    });
    try {
      const result = await extractMetadataFromBuffer(Buffer.from("fake-png"), "image/png", "x.png");
      expect(calledUrl).toBe("http://metadata.test:8005/extract");
      expect(method).toBe("POST");
      expect(result.sourceTool).toBe("a1111");
    } finally {
      restoreFetch();
    }
  });
});

test("metadata client uses the localhost default when METADATA_API_URL is unset", async () => {
  await withEnv({ METADATA_API_URL: "" }, async () => {
    let calledUrl: string | undefined;
    stubFetch(async (input) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(A1111_EXTRACT);
    });
    try {
      await extractMetadataFromBuffer(Buffer.from("x"), "image/png", "x.png");
      // Empty env resolves to the local-dev default rather than crashing.
      expect(calledUrl).toBe("http://localhost:8005/extract");
    } finally {
      restoreFetch();
    }
  });
  // The not-configured guard still exists for callers that null the URL out.
  expect(MetadataServiceNotConfiguredError).toBeTruthy();
});

test("metadata client maps 422 (no recognized metadata) to an empty unknown result", async () => {
  await withEnv({ METADATA_API_URL: "http://metadata.test:8005" }, async () => {
    stubFetch(async () => new Response("no metadata", { status: 422 }));
    try {
      const result = await extractMetadataFromBuffer(Buffer.from("plain"), "image/png", "x.png");
      expect(result.sourceTool).toBe("unknown");
      expect(result.prompt).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.references.checkpoints).toEqual([]);
    } finally {
      restoreFetch();
    }
  });
});

test("metadata client throws on non-OK, non-422 responses (service down)", async () => {
  await withEnv({ METADATA_API_URL: "http://metadata.test:8005" }, async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    try {
      await expect(
        extractMetadataFromBuffer(Buffer.from("x"), "image/png", "x.png"),
      ).rejects.toThrow(/deedlit\.metadata \/extract 500/);
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// mapExtractResult → monolith metadata shape
// ---------------------------------------------------------------------------

test("mapExtractResult maps an A1111 ExtractResult into the monolith shape", () => {
  const mapped = mapExtractResult(A1111_EXTRACT);
  expect(mapped.sourceTool).toBe("a1111");
  expect(mapped.prompt).toBe("masterpiece, 1girl, blue eyes");
  expect(mapped.negativePrompt).toBe("lowres, bad anatomy");
  expect(mapped.tags).toEqual(["masterpiece", "1girl", "blue eyes"]);
  expect(mapped.model).toBeNull(); // references empty until #7
  expect(mapped.workflowJson).toBeNull();
  expect(mapped.params).toMatchObject({
    seed: 1234567890,
    steps: 28,
    cfgScale: 7.5, // cfg → cfgScale rename
    sampler: "DPM++ 2M Karras",
    width: 512,
    height: 768,
    clipSkip: null, // clipskip → clipSkip rename
  });
});

test("mapExtractResult maps a ComfyUI ExtractResult, resolving model + workflow", () => {
  const mapped = mapExtractResult(COMFY_EXTRACT);
  expect(mapped.sourceTool).toBe("comfyui");
  expect(mapped.model).toBe("sdxl_base.safetensors"); // from references.checkpoints[0]
  expect(mapped.workflowJson).toEqual({ nodes: [{ id: 1 }] });
  expect(mapped.params.scheduler).toBe("normal");
  expect(mapped.params.denoise).toBe(1);
});

test("mapExtractResult collapses the 'unknown' source tool to null", () => {
  const mapped = mapExtractResult({
    sourceTool: "unknown",
    prompt: null,
    negative: null,
    tags: [],
    params: {},
    references: { checkpoints: [], loras: [], embeddings: [], vae: [], controlnets: [], upscalers: [] },
    workflow_json: null,
    api_prompt_json: null,
  });
  expect(mapped.sourceTool).toBeNull();
  expect(mapped.prompt).toBeNull();
  expect(mapped.params.cfgScale).toBeNull();
});

test("mapExtractResult falls back to api_prompt_json when workflow_json is absent", () => {
  const mapped = mapExtractResult({ ...COMFY_EXTRACT, workflow_json: null });
  expect(mapped.workflowJson).toEqual({ "1": { class_type: "KSampler" } });
});

// ---------------------------------------------------------------------------
// Embedding path: vision is MANDATORY (no pixel-histogram fallback)
// ---------------------------------------------------------------------------

test("generateImageEmbedding throws when CLIP_VISION_API_URL is unset (no fallback)", async () => {
  await withEnv({ CLIP_VISION_API_URL: "" }, async () => {
    await expect(generateImageEmbedding("C:/does/not/matter.png")).rejects.toBeInstanceOf(
      VisionServiceNotConfiguredError,
    );
  });
});

test("generateImageEmbeddingFromBuffer throws when CLIP_VISION_API_URL is unset", async () => {
  await withEnv({ CLIP_VISION_API_URL: "" }, async () => {
    await expect(
      generateImageEmbeddingFromBuffer(Buffer.from("img"), "image/png", "x.png"),
    ).rejects.toBeInstanceOf(VisionServiceNotConfiguredError);
  });
});

test("generateTextEmbedding throws when CLIP_VISION_API_URL is unset (no hash fallback)", async () => {
  await withEnv({ CLIP_VISION_API_URL: "" }, async () => {
    await expect(generateTextEmbedding("a castle at dusk")).rejects.toBeInstanceOf(
      VisionServiceNotConfiguredError,
    );
  });
});

test("generateImageEmbeddingFromBuffer routes through deedlit.vision when configured", async () => {
  await withEnv({ CLIP_VISION_API_URL: "http://vision.test:8000" }, async () => {
    let calledUrl: string | undefined;
    stubFetch(async (input) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse({ embedding: [0.1, 0.2, 0.3] });
    });
    try {
      const vec = await generateImageEmbeddingFromBuffer(Buffer.from("img"), "image/png", "x.png");
      expect(calledUrl).toBe("http://vision.test:8000/embed/image");
      expect(vec).toEqual([0.1, 0.2, 0.3]);
    } finally {
      restoreFetch();
    }
  });
});
