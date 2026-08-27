import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "ops-intelligence-command-center.mock.spec.ts",
  timeout: 60_000,
  // A cold Vite transform can take longer than the application-ready state itself.
  expect: { timeout: 45_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8082",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8082",
    port: 8082,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E_OPS_INTELLIGENCE: "true",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "ops-intelligence-local-publishable-key",
    },
  },
});
