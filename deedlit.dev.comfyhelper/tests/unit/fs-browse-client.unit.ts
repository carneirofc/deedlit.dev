import { test, expect } from "@playwright/test";

import { browseFs, GatewayError } from "../../lib/api-client";

// ---------------------------------------------------------------------------
// Harness: record the single outbound fetch (url/method) and reply. Mirrors
// notes-collections-client.unit.ts.
// ---------------------------------------------------------------------------

type Captured = { url?: string; method?: string };

const realFetch = globalThis.fetch;

function captureFetch(reply: unknown, status = 200): Captured {
  const cap: Captured = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.url = input.toString();
    cap.method = init?.method ?? "GET";
    return new Response(JSON.stringify(reply), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return cap;
}

function restore() {
  globalThis.fetch = realFetch;
}

function withBase(url: string, fn: () => Promise<void>) {
  const prev = process.env.DEEDLIT_API_URL;
  process.env.DEEDLIT_API_URL = url;
  delete process.env.NEXT_PUBLIC_DEEDLIT_API_URL;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.DEEDLIT_API_URL;
    else process.env.DEEDLIT_API_URL = prev;
  });
}

const BASE = "http://gw.test:8080";

test("browseFs GETs /fs/browse with the path query param", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({
      path: "K:/comfyui/output",
      parent: "K:/comfyui",
      separator: "\\",
      entries: [{ name: "sub", path: "K:/comfyui/output/sub", isDirectory: true }],
      roots: [{ label: "K:\\", path: "K:\\" }],
    });
    try {
      const res = await browseFs("K:/comfyui/output");
      expect(cap.url).toBe(`${BASE}/fs/browse?path=K%3A%2Fcomfyui%2Foutput`);
      expect(cap.method).toBe("GET");
      expect(res.path).toBe("K:/comfyui/output");
      expect(res.entries[0].isDirectory).toBe(true);
    } finally {
      restore();
    }
  });
});

test("browseFs omits the path param for the roots view", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({
      path: null,
      parent: null,
      separator: "/",
      entries: [],
      roots: [{ label: "/", path: "/" }],
    });
    try {
      const res = await browseFs(null);
      expect(cap.url).toBe(`${BASE}/fs/browse`);
      expect(res.path).toBeNull();
      expect(res.roots).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

test("browseFs surfaces a 400 as a GatewayError the picker can show inline", async () => {
  await withBase(BASE, async () => {
    captureFetch({ detail: "Folder not found: /nope" }, 400);
    try {
      const err = await browseFs("/nope").then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).status).toBe(400);
      expect((err as GatewayError).message).toContain("not found");
    } finally {
      restore();
    }
  });
});
