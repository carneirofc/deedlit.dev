import { test, expect } from "@playwright/test";

import {
  hasMixedSeparators,
  isAlreadyConfigured,
  isImageFile,
  normalizePath,
  pathKey,
  splitPaths,
} from "../../lib/library/paths";

// ---------------------------------------------------------------------------
// normalizePath — tidies without ever swapping separators (the ingest host can
// be Windows or POSIX, so a `/` path must stay `/` and `\` must stay `\`).
// ---------------------------------------------------------------------------

test("normalizePath trims and drops a trailing separator", () => {
  expect(normalizePath("  K:/comfyui/output  ")).toBe("K:/comfyui/output");
  expect(normalizePath("K:/comfyui/output/")).toBe("K:/comfyui/output");
  expect(normalizePath("/mnt/data/")).toBe("/mnt/data");
});

test("normalizePath collapses accidental doubled separators", () => {
  expect(normalizePath("K:/comfyui//output")).toBe("K:/comfyui/output");
  expect(normalizePath("C:\\a\\\\b")).toBe("C:\\a\\b");
});

test("normalizePath preserves roots and the UNC prefix", () => {
  expect(normalizePath("/")).toBe("/");
  expect(normalizePath("C:\\")).toBe("C:\\");
  expect(normalizePath("C:/")).toBe("C:/");
  expect(normalizePath("\\\\server\\share\\out\\")).toBe("\\\\server\\share\\out");
});

test("normalizePath never converts the separator style", () => {
  expect(normalizePath("/mnt/data/output")).toBe("/mnt/data/output");
  expect(normalizePath("C:\\comfyui\\output")).toBe("C:\\comfyui\\output");
});

test("normalizePath returns empty for blank input", () => {
  expect(normalizePath("   ")).toBe("");
  expect(normalizePath("")).toBe("");
});

// ---------------------------------------------------------------------------
// splitPaths — multiline bulk entry, normalized + de-duplicated, order kept.
// ---------------------------------------------------------------------------

test("splitPaths normalizes, drops blanks, and de-dupes case-insensitively", () => {
  // "K:/A" and "k:/a" are case-insensitive duplicates of the first entry.
  const raw = "K:/a/\n\n  K:/b  \nK:/A\nk:/a";
  expect(splitPaths(raw)).toEqual(["K:/a", "K:/b"]);
});

test("splitPaths handles CRLF line endings", () => {
  expect(splitPaths("K:/a\r\nK:/b")).toEqual(["K:/a", "K:/b"]);
});

// ---------------------------------------------------------------------------
// dedupe + separator-mismatch + image-extension helpers.
// ---------------------------------------------------------------------------

test("isAlreadyConfigured compares normalized + case-insensitively", () => {
  const existing = ["K:/comfyui/output", "/mnt/data"];
  expect(isAlreadyConfigured("k:/comfyui/output/", existing)).toBe(true);
  expect(isAlreadyConfigured("K:/comfyui/other", existing)).toBe(false);
  expect(isAlreadyConfigured("", existing)).toBe(false);
});

test("pathKey is the lower-cased normalized form", () => {
  expect(pathKey("  K:/Comfy/Out/  ")).toBe("k:/comfy/out");
});

test("hasMixedSeparators flags a mixed path but not a clean one or UNC", () => {
  expect(hasMixedSeparators("K:\\comfyui/output")).toBe(true);
  expect(hasMixedSeparators("K:/comfyui/output")).toBe(false);
  expect(hasMixedSeparators("C:\\comfyui\\output")).toBe(false);
  expect(hasMixedSeparators("\\\\server\\share\\out")).toBe(false);
});

test("isImageFile matches supported extensions case-insensitively", () => {
  expect(isImageFile("render.PNG")).toBe(true);
  expect(isImageFile("a.jpeg")).toBe(true);
  expect(isImageFile("a.webp")).toBe(true);
  expect(isImageFile("notes.txt")).toBe(false);
  expect(isImageFile("noext")).toBe(false);
});
