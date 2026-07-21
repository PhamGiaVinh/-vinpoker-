import { defineConfig } from "@playwright/test";

const localSupabaseUrl = "http://127.0.0.1:54329";

export default defineConfig({
  testDir: ".",
  testMatch: "dealer-swing-phone.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../test-results/dealer-swing-phone",
  use: {
    baseURL: "http://127.0.0.1:8087",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    { name: "phone-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "phone-430", use: { viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8087",
    url: "http://127.0.0.1:8087",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: localSupabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: "dealer-swing-phone-local-publishable-key",
    },
  },
});
