import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/portfolio",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4184",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4184 --strictPort",
    url: "http://127.0.0.1:4184",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:4199",
      VITE_SUPABASE_ANON_KEY: "portfolio-local-fixture",
    },
  },
});
