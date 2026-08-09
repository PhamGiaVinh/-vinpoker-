import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["supabase/functions/series-intelligence-copilot/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
