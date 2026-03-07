import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*verify*.spec.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
