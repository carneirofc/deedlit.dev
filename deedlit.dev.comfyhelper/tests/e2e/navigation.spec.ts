import { expect, test } from "@playwright/test";

test.describe("Sidebar navigation", () => {
  test("navigates between Gallery, Statistics, and Admin", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("gallery-page")).toBeVisible();
    await expect(page.getByTestId("nav-home-link")).toBeVisible();

    await page.getByTestId("nav-link-statistics").click();
    await expect(page).toHaveURL(/\/stats$/);
    await expect(page.getByTestId("stats-page")).toBeVisible();

    await page.getByTestId("nav-link-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("admin-page")).toBeVisible();

    await page.getByTestId("nav-home-link").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("gallery-page")).toBeVisible();
  });
});
