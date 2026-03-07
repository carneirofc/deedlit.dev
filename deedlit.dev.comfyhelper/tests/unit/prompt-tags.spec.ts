import { expect, test } from "@playwright/test";

import { extractTagsFromPrompt, normalizeExcludedTags } from "../../lib/prompt-tags";

test.describe("prompt tag extraction", () => {
  test("splits on commas, trims, replaces newlines with spaces, and deduplicates", () => {
    const prompt = "  tag one,\n tag two  , tag three\nline , , TAG ONE ";
    const result = extractTagsFromPrompt(prompt);

    expect(result).toEqual(["tag one", "tag two", "tag three line"]);
  });

  test("supports exclusion lists with the same normalization rules", () => {
    const prompt = "tag one, tag two, tag three";
    const result = extractTagsFromPrompt(prompt, {
      exclude: [" tag two ", "tag\nthree"],
    });

    expect(result).toEqual(["tag one"]);
  });

  test("does not apply additional semantic filtering", () => {
    const prompt = "BREAK, (tag:1.2), <lora:test:1>";
    const result = extractTagsFromPrompt(prompt);

    expect(result).toEqual(["break", "(tag:1.2)", "<lora:test:1>"]);
  });
});

test.describe("excluded tag normalization", () => {
  test("normalizes by trimming, lowercasing, newline replacement, and dedupe", () => {
    const result = normalizeExcludedTags(["  Foo ", "foo", "bar\nbaz", "", "   "]);
    expect(result).toEqual(["foo", "bar baz"]);
  });
});
