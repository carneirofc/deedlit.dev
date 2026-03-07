import { expect, test } from "@playwright/test";

test.describe("Statistics page", () => {
  test("loads statistics and supports manual refresh", async ({ page }) => {
    await page.goto("/stats");

    await expect(page.getByTestId("stats-page")).toBeVisible();

    const refreshButton = page.getByTestId("stats-refresh-button");
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).toBeEnabled();
    await refreshButton.click();

    await expect(page.getByTestId("stats-last-updated")).toBeVisible();

    const emptyState = page.getByTestId("stats-empty-state");
    if ((await emptyState.count()) === 0) {
      await expect(page.getByTestId("metric-total-cached-images")).toBeVisible();
      await expect(page.getByTestId("stats-list-top-positive-tags-list")).toBeVisible();
    }

    // Tag extraction intentionally keeps prompt tokens as-is after comma split normalization.
    // Do not assert filtering heuristics for graph-like labels here.
  });
});
