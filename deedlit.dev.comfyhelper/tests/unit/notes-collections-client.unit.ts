import { test, expect } from "@playwright/test";

import {
  createNote,
  getNote,
  updateNote,
  exportNote,
  notesByImage,
  createCollection,
  listCollections,
  getCollection,
  renameCollection,
  deleteCollection,
  setCollectionImages,
  collectionsByImage,
  type NoteUpsert,
} from "../../lib/api-client";

// ---------------------------------------------------------------------------
// Harness: record the single outbound fetch (url/method/body) and reply.
// ---------------------------------------------------------------------------

type Captured = { url?: string; method?: string; body?: unknown };

const realFetch = globalThis.fetch;

function captureFetch(reply: unknown, status = 200): Captured {
  const cap: Captured = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.url = input.toString();
    cap.method = init?.method ?? "GET";
    cap.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(status === 204 ? null : JSON.stringify(reply), {
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
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test("createNote POSTs the note body to /notes and returns the saved note", async () => {
  await withBase(BASE, async () => {
    const note: NoteUpsert = {
      title: "study",
      positive: "knight, castle",
      negative: "blurry",
      blocks: { time: 1, blocks: [], version: "2.0" },
      imageRefs: [SHA],
    };
    const cap = captureFetch({ id: "n1", ...note });
    try {
      const saved = await createNote(note);
      expect(cap.url).toBe(`${BASE}/notes`);
      expect(cap.method).toBe("POST");
      expect(cap.body).toEqual(note);
      expect(saved.id).toBe("n1");
      expect(saved.imageRefs).toEqual([SHA]);
    } finally {
      restore();
    }
  });
});

test("getNote GETs /notes/{id}", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ id: "n1", blocks: {}, imageRefs: [] });
    try {
      const n = await getNote("n1");
      expect(cap.url).toBe(`${BASE}/notes/n1`);
      expect(cap.method).toBe("GET");
      expect(n.id).toBe("n1");
    } finally {
      restore();
    }
  });
});

test("updateNote PUTs the body to /notes/{id}", async () => {
  await withBase(BASE, async () => {
    const note: NoteUpsert = { blocks: { blocks: [] }, imageRefs: [SHA], positive: "x" };
    const cap = captureFetch({ id: "n1", ...note });
    try {
      await updateNote("n1", note);
      expect(cap.url).toBe(`${BASE}/notes/n1`);
      expect(cap.method).toBe("PUT");
      expect(cap.body).toEqual(note);
    } finally {
      restore();
    }
  });
});

test("exportNote GETs /notes/{id}/export", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ id: "n1", blocks: {}, imageRefs: [] });
    try {
      await exportNote("n1");
      expect(cap.url).toBe(`${BASE}/notes/n1/export`);
      expect(cap.method).toBe("GET");
    } finally {
      restore();
    }
  });
});

test("notesByImage GETs /notes/by-image/{sha} and tolerates a non-array", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch([{ id: "n1", blocks: {}, imageRefs: [SHA] }]);
    try {
      const notes = await notesByImage(SHA);
      expect(cap.url).toBe(`${BASE}/notes/by-image/${SHA}`);
      expect(notes).toHaveLength(1);
    } finally {
      restore();
    }

    const cap2 = captureFetch({});
    try {
      expect(await notesByImage(SHA)).toEqual([]);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

test("createCollection POSTs name + images to /collections", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ id: "c1", name: "faves", images: [SHA] });
    try {
      const c = await createCollection({ name: "faves", images: [SHA] });
      expect(cap.url).toBe(`${BASE}/collections`);
      expect(cap.method).toBe("POST");
      expect(cap.body).toEqual({ name: "faves", images: [SHA] });
      expect(c.id).toBe("c1");
    } finally {
      restore();
    }
  });
});

test("listCollections GETs /collections and tolerates a non-array", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch([{ id: "c1", name: "faves", images: [] }]);
    try {
      const cols = await listCollections();
      expect(cap.url).toBe(`${BASE}/collections`);
      expect(cols).toHaveLength(1);
    } finally {
      restore();
    }

    const cap2 = captureFetch(null);
    try {
      expect(await listCollections()).toEqual([]);
    } finally {
      restore();
    }
  });
});

test("getCollection GETs /collections/{id}", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ id: "c1", name: "faves", images: [SHA] });
    try {
      const c = await getCollection("c1");
      expect(cap.url).toBe(`${BASE}/collections/c1`);
      expect(c.images).toEqual([SHA]);
    } finally {
      restore();
    }
  });
});

test("renameCollection PUTs the new name to /collections/{id}", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ id: "c1", name: "renamed", images: [] });
    try {
      const c = await renameCollection("c1", "renamed");
      expect(cap.url).toBe(`${BASE}/collections/c1`);
      expect(cap.method).toBe("PUT");
      expect(cap.body).toEqual({ name: "renamed" });
      expect(c.name).toBe("renamed");
    } finally {
      restore();
    }
  });
});

test("deleteCollection DELETEs /collections/{id}", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ status: "ok" });
    try {
      await deleteCollection("c1");
      expect(cap.url).toBe(`${BASE}/collections/c1`);
      expect(cap.method).toBe("DELETE");
    } finally {
      restore();
    }
  });
});

test("setCollectionImages PUTs the ordered list to /collections/{id}/images", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch({ status: "ok" });
    try {
      await setCollectionImages("c1", [SHA, SHA2]);
      expect(cap.url).toBe(`${BASE}/collections/c1/images`);
      expect(cap.method).toBe("PUT");
      expect(cap.body).toEqual({ images: [SHA, SHA2] });
    } finally {
      restore();
    }
  });
});

test("collectionsByImage GETs /collections/by-image/{sha}", async () => {
  await withBase(BASE, async () => {
    const cap = captureFetch([{ id: "c1", name: "faves", images: [SHA] }]);
    try {
      const cols = await collectionsByImage(SHA);
      expect(cap.url).toBe(`${BASE}/collections/by-image/${SHA}`);
      expect(cols[0].id).toBe("c1");
    } finally {
      restore();
    }
  });
});
