import { test, expect } from "@playwright/test";

import { deleteImages } from "../../lib/library/bulk-delete";

// ---------------------------------------------------------------------------
// Harness: stub fetch with a single reply and record every call so we can assert
// the bulk delete hits the ONE batch route with POST + the right body.
// ---------------------------------------------------------------------------

type Reply = { status: number; body?: unknown; throws?: boolean };

const realFetch = globalThis.fetch;
const BATCH_URL = "/api/library/images/batch-delete";

function stubFetch(reply: Reply) {
  const calls: { url: string; method: string; ids: string[] }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const ids = init?.body ? (JSON.parse(String(init.body)).ids ?? []) : [];
    calls.push({ url, method: init?.method ?? "GET", ids });
    if (reply.throws) throw new Error("network down");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls };
}

function restore() {
  globalThis.fetch = realFetch;
}

// ---------------------------------------------------------------------------

test("deleteImages POSTs once to the batch route and reports all deleted", async () => {
  const probe = stubFetch({ status: 200, body: { deleted: ["a", "b", "c"], missing: [] } });
  try {
    const out = await deleteImages(["a", "b", "c"]);
    expect(out.deleted.sort()).toEqual(["a", "b", "c"]);
    expect(out.failed).toEqual([]);
    // ONE call (not one per id), to the batch route, with the ids in the body.
    expect(probe.calls.length).toBe(1);
    expect(probe.calls[0].url).toBe(BATCH_URL);
    expect(probe.calls[0].method).toBe("POST");
    expect(probe.calls[0].ids.sort()).toEqual(["a", "b", "c"]);
  } finally {
    restore();
  }
});

test("deleteImages treats a `missing` id (already gone) as deleted", async () => {
  stubFetch({ status: 200, body: { deleted: [], missing: ["gone"] } });
  try {
    const out = await deleteImages(["gone"]);
    expect(out.deleted).toEqual(["gone"]);
    expect(out.failed).toEqual([]);
  } finally {
    restore();
  }
});

test("deleteImages marks ids the server didn't delete as failed", async () => {
  // Server removed ok1; ok2 already gone; "stuck" came back in neither list.
  stubFetch({ status: 200, body: { deleted: ["ok1"], missing: ["ok2"] } });
  try {
    const out = await deleteImages(["ok1", "ok2", "stuck"]);
    expect(out.deleted.sort()).toEqual(["ok1", "ok2"]);
    expect(out.failed).toEqual([{ id: "stuck", error: "not deleted" }]);
  } finally {
    restore();
  }
});

test("deleteImages maps a non-2xx response to every id failing", async () => {
  stubFetch({ status: 502, body: { error: "catalog unavailable" } });
  try {
    const out = await deleteImages(["a", "b"]);
    expect(out.deleted).toEqual([]);
    expect(out.failed).toEqual([
      { id: "a", error: "catalog unavailable" },
      { id: "b", error: "catalog unavailable" },
    ]);
  } finally {
    restore();
  }
});

test("deleteImages maps a transport error to every id failing", async () => {
  stubFetch({ status: 0, throws: true });
  try {
    const out = await deleteImages(["a", "b"]);
    expect(out.deleted).toEqual([]);
    expect(out.failed.map((f) => f.error)).toEqual(["network down", "network down"]);
  } finally {
    restore();
  }
});

test("deleteImages on an empty list does no work", async () => {
  const probe = stubFetch({ status: 200, body: {} });
  try {
    const out = await deleteImages([]);
    expect(out).toEqual({ deleted: [], failed: [] });
    expect(probe.calls.length).toBe(0);
  } finally {
    restore();
  }
});
