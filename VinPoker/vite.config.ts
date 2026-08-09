import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { execFileSync } from "node:child_process";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

const opsHtmlFallbackPlugin = (): Plugin => ({
  name: "ops-html-fallback",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/ops" || pathname.startsWith("/ops/")) req.url = "/ops.html";
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/ops" || pathname.startsWith("/ops/")) req.url = "/ops.html";
      next();
    });
  },
});

// Writes the exact build version to a static marker consumed by stale clients.
const versionStampPlugin = (version: string): Plugin => ({
  name: "version-stamp",
  apply: "build",
  buildStart() {
    const target = path.resolve(__dirname, "public/version.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ version }) + "\n");
  },
});

const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;

function normalizeBuildGitSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return null;
  return GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

function resolveBuildGitSha(): string | null {
  const fromEnvironment = [
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.CI_COMMIT_SHA,
  ];
  for (const value of fromEnvironment) {
    const normalized = normalizeBuildGitSha(value);
    if (normalized) return normalized;
  }

  // A CI/hosted build must fail closed rather than silently identifying itself
  // with whatever checkout happens to be present on the runner.
  if (process.env.CI || process.env.VERCEL) return null;

  try {
    const localRevision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return normalizeBuildGitSha(localRevision);
  } catch {
    return null;
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildVersion = String(Date.now());
  const buildGitSha = resolveBuildGitSha();

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      opsHtmlFallbackPlugin(),
      mode === "development" && componentTagger(),
      versionStampPlugin(buildVersion),
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
      __APP_VERSION__: JSON.stringify(buildVersion),
      __APP_GIT_COMMIT_SHA__: JSON.stringify(buildGitSha),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    build: {
      // Manual vendor chunks caused a circular import between vendor-react and
      // vendor-charts. Let Rollup decide chunking to keep lazy routes safe.
      sourcemap: "hidden",
      rollupOptions: {
        input: {
          player: path.resolve(__dirname, "index.html"),
          ops: path.resolve(__dirname, "ops.html"),
        },
      },
    },
  };
});
