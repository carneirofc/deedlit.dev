import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/unit",
  fullyParallel: false,
  workers: 1,
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["list"]],
});
