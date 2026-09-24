import { defineConfig } from "@playwright/test";

// Each spec boots its own scenario of the app (lib/app.mjs) on one port, so they run one at a time.
export default defineConfig({
  testDir: "tests",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { launchOptions: { args: ["--hide-scrollbars"] } },
});
