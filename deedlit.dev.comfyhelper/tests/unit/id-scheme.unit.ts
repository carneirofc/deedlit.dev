import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAMESPACE, pointIdForSha256 } from "../../lib/library/id-scheme";

type Vectors = {
  namespace: string;
  vectors: Array<{ label: string; sha256: string; pointId: string }>;
};

const vectorsPath = join(__dirname, "..", "..", "..", "id-scheme", "vectors.json");
const fixtures = JSON.parse(readFileSync(vectorsPath, "utf8")) as Vectors;

test("namespace matches the frozen shared constant", () => {
  expect(NAMESPACE).toBe(fixtures.namespace);
});

for (const v of fixtures.vectors) {
  test(`pointIdForSha256 reproduces the shared vector: ${v.label}`, () => {
    expect(pointIdForSha256(v.sha256)).toBe(v.pointId);
  });
}
