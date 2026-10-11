import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  expect: { timeout: 20000 },
  use: { baseURL: "http://127.0.0.1:4317", headless: true },
  webServer: {
    command: "npm run dev -- --port 4317",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 180000,
  },
  workers: 1,
});
