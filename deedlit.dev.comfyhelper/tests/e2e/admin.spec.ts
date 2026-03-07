import { expect, test } from "@playwright/test";

test.describe("Admin page", () => {
  test("shows statistics/parsing excluded tags controls", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("trashcan-directory-input")).toBeVisible();
    await expect(page.getByTestId("stats-parsing-excluded-tags-input")).toBeVisible();
    await expect(page.getByTestId("excluded-tags-preview")).toBeVisible();

    const draftInput = page.getByTestId("stats-parsing-excluded-tag-draft-input");
    await draftInput.fill("noisy_test_tag");
    await page.getByTestId("add-excluded-tag-button").click();

    await expect(page.getByTestId("stats-parsing-excluded-tags-input")).toHaveValue(/noisy_test_tag/);
  });

  test("opens and cancels the rescan confirmation dialog", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByTestId("admin-header")).toBeVisible();
    await expect(page.getByTestId("admin-scan-control-panel")).toBeVisible();

    const runScanButton = page.getByTestId("run-scan-button");

    await expect(runScanButton).toBeVisible();
    await expect(runScanButton).toBeEnabled();
    await runScanButton.click();

    await expect(page.getByTestId("admin-confirmation-dialog")).toBeVisible();
    await page.getByTestId("admin-confirmation-cancel-button").click();
    await expect(page.getByTestId("admin-confirmation-dialog")).toBeHidden();
  });
});
