import { test, expect } from "@playwright/test";

import { deleteImages } from "../../lib/library/bulk-delete";

// ---------------------------------------------------------------------------
// Harness: stub fetch with a per-url reply table and record every call so we
// can assert the fan-out hit the right per-image route with DELETE.
// ---------------------------------------------------------------------------

type Reply = { status: number; body?: unknown; throws?: boolean };

const realFetch = globalThis.fetch;

function stubFetch(table: (url: string) => Reply) {
  const calls: { url: string; method: string }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, method: init?.method ?? "GET" });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield so concurrent lanes actually overlap before any resolves.
    await Promise.resolve();
    inFlight -= 1;
    const r = table(url);
    if (r.throws) throw new Error("network down");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls, maxInFlight: () => maxInFlight };
}

function restore() {
  globalThis.fetch = realFetch;
}

const path = (id: string) => `/api/library/images/${id}`;

// ---------------------------------------------------------------------------

test("deleteImages DELETEs each id's un-index route and reports all deleted", async () => {
  const probe = stubFetch(() => ({ status: 200, body: { status: "ok" } }));
  try {
    const out = await deleteImages(["a", "b", "c"]);
    expect(out.deleted.sort()).toEqual(["a", "b", "c"]);
    expect(out.failed).toEqual([]);
    expect(probe.calls.every((c) => c.method === "DELETE")).toBe(true);
    expect(probe.calls.map((c) => c.url).sort()).toEqual([path("a"), path("b"), path("c")]);
  } finally {
    restore();
  }
});

test("deleteImages treats 404 (already gone) as deleted", async () => {
  stubFetch(() => ({ status: 404, body: { error: "image not found" } }));
  try {
    const out = await deleteImages(["gone"]);
    expect(out.deleted).toEqual(["gone"]);
    expect(out.failed).toEqual([]);
  } finally {
    restore();
  }
});

test("deleteImages collects partial failures without dropping the successes", async () => {
  stubFetch((url) => {
    if (url === path("bad")) return { status: 500, body: { error: "catalog unavailable" } };
    if (url === path("boom")) return { status: 0, throws: true };
    return { status: 200, body: { status: "ok" } };
  });
  try {
    const out = await deleteImages(["ok1", "bad", "ok2", "boom"]);
    expect(out.deleted.sort()).toEqual(["ok1", "ok2"]);
    expect(out.failed.find((f) => f.id === "bad")?.error).toBe("catalog unavailable");
    expect(out.failed.find((f) => f.id === "boom")?.error).toBe("network down");
    expect(out.failed.length).toBe(2);
  } finally {
    restore();
  }
});

test("deleteImages never exceeds the concurrency cap", async () => {
  const probe = stubFetch(() => ({ status: 200, body: {} }));
  try {
    await deleteImages(["a", "b", "c", "d", "e", "f"], { concurrency: 2 });
    expect(probe.maxInFlight()).toBeLessThanOrEqual(2);
    expect(probe.calls.length).toBe(6);
  } finally {
    restore();
  }
});

test("deleteImages on an empty list does no work", async () => {
  const probe = stubFetch(() => ({ status: 200 }));
  try {
    const out = await deleteImages([]);
    expect(out).toEqual({ deleted: [], failed: [] });
    expect(probe.calls.length).toBe(0);
  } finally {
    restore();
  }
});
