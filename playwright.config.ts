import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 120000,
  expect: { timeout: 45000 },
  use: {
    baseURL: process.env.SORTITION_BROWSER_URL || "http://127.0.0.1:4317",
    headless: true,
  },
  webServer: process.env.SORTITION_BROWSER_URL
    ? undefined
    : {
        command: "npm run dev -- --port 4317",
        url: "http://127.0.0.1:4317",
        reuseExistingServer: false,
        timeout: 180000,
      },
  workers: 1,
});
