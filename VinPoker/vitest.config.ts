import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "e2e/**", ".{idea,git,cache,output,temp}/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Vitest-ONLY: the pure poker engine lives outside src so the client Vite
      // build (vite.config.ts has no @engine alias) cannot import it — that build
      // failure is the server-authoritative guardrail. Do NOT add this to vite.config.ts.
      "@engine": path.resolve(__dirname, "./supabase/functions/_shared/pokerEngine"),
      // Vitest-ONLY: tracker server validation engine. Same guardrail as @engine —
      // it must NOT be reachable from the client Vite build. Do NOT add to vite.config.ts.
      "@tracker-engine": path.resolve(__dirname, "./supabase/functions/_shared/trackerEngine"),
      // Vitest-only settlement contract. Keep server accounting out of the client bundle.
      "@settlement": path.resolve(__dirname, "./supabase/functions/_shared/trackerSettlement"),
    },
  },
});
