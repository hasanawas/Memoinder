import { defineConfig, devices } from "@playwright/test";

const port = 3100;
// Same prefix as GitHub Pages, so path mistakes show up in tests.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ??= "/Memoinder");

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // A fixed browser time zone keeps "default zone" assertions deterministic.
  use: { baseURL: `http://localhost:${port}${basePath}/`, trace: "on-first-retry", timezoneId: "Asia/Karachi" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the static build, served the way GitHub Pages serves it.
  webServer: {
    command: `npm run build && node scripts/serve-static.mjs ${port}`,
    url: `http://localhost:${port}${basePath}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
