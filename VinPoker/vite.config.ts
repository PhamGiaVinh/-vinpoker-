import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

// Writes a fresh build timestamp into public/version.json on every build
// so the running app can detect when a new deploy is live.
const versionStampPlugin = (): Plugin => ({
  name: "version-stamp",
  apply: "build",
  buildStart() {
    const version = String(Date.now());
    const target = path.resolve(__dirname, "public/version.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ version }) + "\n");
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    versionStampPlugin(),
    mode === "analyze" &&
      (visualizer({
        filename: "dist/stats.html",
        open: false,
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
      }) as unknown as Plugin),
  ].filter(Boolean),
  define: {
    __APP_VERSION__: JSON.stringify(String(Date.now())),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Manual vendor chunks were causing a circular import between
    // vendor-react and vendor-charts that crashed the app at boot
    // ("Cannot access 'P' before initialization"). Let Rollup decide
    // chunking automatically — it's safe and keeps lazy routes split.
    sourcemap: "hidden",
  },
}));
