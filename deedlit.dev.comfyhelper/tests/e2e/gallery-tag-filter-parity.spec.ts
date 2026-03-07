import { expect, test, type Locator, type Page } from "@playwright/test";

import { extractTagsFromPrompt, normalizeTag } from "../../lib/prompt-tags";

const MAX_IMAGES_TO_SAMPLE = 20;
const MAX_POSITIVE_TAGS_PER_IMAGE = 6;
const MAX_NEGATIVE_TAGS_PER_IMAGE = 4;
const UI_SETTLE_MS = 120;
const IMAGE_DISCOVERY_TIMEOUT_MS = 12_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDockToggle(page: Page): Locator {
  return page.getByTestId("gallery-filters-dock-toggle");
}

async function waitForGalleryImages(page: Page, timeoutMs: number): Promise<number> {
  const imageCards = page.locator('[data-gallery-image-card="true"]');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const count = await imageCards.count();
    if (count > 0) {
      return count;
    }
    await page.waitForTimeout(250);
  }

  return imageCards.count();
}

async function isFiltersDockOpen(page: Page): Promise<boolean> {
  return (await getDockToggle(page).getAttribute("aria-expanded")) === "true";
}

async function openFiltersDock(page: Page): Promise<void> {
  const toggle = getDockToggle(page);
  if (await isFiltersDockOpen(page)) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function closeFiltersDock(page: Page): Promise<void> {
  const toggle = getDockToggle(page);
  if (!(await isFiltersDockOpen(page))) return;

  await page.keyboard.press("Escape");
  if (await isFiltersDockOpen(page)) {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}

function getTagLabelLocator(page: Page, kind: "positive" | "negative", tag: string): Locator {
  const containerSelector = kind === "positive" ? "#positive-tags-filter" : "#negative-tags-filter";
  return page
    .locator(`${containerSelector} button span`)
    .filter({ hasText: new RegExp(`^${escapeRegExp(tag)}$`, "i") })
    .first();
}

async function assertFilterContainsTag(page: Page, kind: "positive" | "negative", tag: string): Promise<void> {
  const searchInputPlaceholder = kind === "positive" ? "Search positive tags" : "Search negative tags";
  await page.getByPlaceholder(searchInputPlaceholder).fill(tag);
  await page.waitForTimeout(UI_SETTLE_MS);
  await expect(getTagLabelLocator(page, kind, tag)).toBeVisible();
}

async function extractExcludedTagSet(page: Page): Promise<Set<string>> {
  const payload = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return [];
      const data = (await response.json()) as { settings?: { excludedTags?: unknown } };
      return Array.isArray(data.settings?.excludedTags) ? data.settings.excludedTags : [];
    } catch {
      return [];
    }
  });

  return new Set(
    payload
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalizeTag(entry))
      .filter(Boolean),
  );
}

test.describe("Gallery tag filter parity", () => {
  test("keeps details-prompt tags discoverable in filter panels", async ({ page }) => {
    page.setDefaultTimeout(8_000);

    await page.goto("/");
    await expect(page.getByTestId("gallery-page")).toBeVisible();

    const imageCards = page.locator('[data-gallery-image-card="true"]');
    const imageCount = await waitForGalleryImages(page, IMAGE_DISCOVERY_TIMEOUT_MS);
    test.skip(imageCount === 0, "No cached gallery images available for tag parity validation.");

    const excludedTagSet = await extractExcludedTagSet(page);
    const sampleSize = Math.min(imageCount, MAX_IMAGES_TO_SAMPLE);
    const missingTags: Array<{ imageIndex: number; kind: "positive" | "negative"; tag: string }> = [];
    let checkedTags = 0;

    for (let index = 0; index < sampleSize; index += 1) {
      await closeFiltersDock(page);

      const card = imageCards.nth(index);
      await card.locator('button[title^="Open details"]').click();
      await expect(page.getByText("Positive Prompt")).toBeVisible();

      const positivePromptSection = page.locator("section").filter({ hasText: "Positive Prompt" }).first();
      const negativePromptSection = page.locator("section").filter({ hasText: "Negative Prompt" }).first();

      const positivePrompt = ((await positivePromptSection.locator("pre").first().textContent()) ?? "").trim();
      const negativePrompt = (await negativePromptSection.count())
        ? (((await negativePromptSection.locator("pre").first().textContent()) ?? "").trim())
        : "";

      await page.keyboard.press("Escape");
      await expect(page.getByText("Positive Prompt")).toBeHidden();
      await page.waitForTimeout(UI_SETTLE_MS);

      const positiveTags = extractTagsFromPrompt(positivePrompt, { exclude: excludedTagSet }).slice(
        0,
        MAX_POSITIVE_TAGS_PER_IMAGE,
      );
      const negativeTags = extractTagsFromPrompt(negativePrompt, { exclude: excludedTagSet }).slice(
        0,
        MAX_NEGATIVE_TAGS_PER_IMAGE,
      );

      if (positiveTags.length === 0 && negativeTags.length === 0) {
        continue;
      }

      await openFiltersDock(page);

      for (const tag of positiveTags) {
        checkedTags += 1;
        try {
          await assertFilterContainsTag(page, "positive", tag);
        } catch {
          missingTags.push({ imageIndex: index, kind: "positive", tag });
        }
      }

      for (const tag of negativeTags) {
        checkedTags += 1;
        try {
          await assertFilterContainsTag(page, "negative", tag);
        } catch {
          missingTags.push({ imageIndex: index, kind: "negative", tag });
        }
      }
    }

    await closeFiltersDock(page);
    expect(checkedTags).toBeGreaterThan(0);
    expect(missingTags).toEqual([]);
  });
});
