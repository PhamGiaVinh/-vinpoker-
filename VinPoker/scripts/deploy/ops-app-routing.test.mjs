import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VERCEL_BUILD_OUTPUT_ROUTES,
  writeVercelBuildOutputConfig,
} from "./write-vercel-build-output-config.mjs";
import { assertShellHtml, verifyLocal } from "./verify-app-shell-routing.mjs";

const player = '<meta name="vinpoker-app-shell" content="player"><link rel="manifest" href="/manifest.webmanifest">';
const ops = '<meta name="vinpoker-app-shell" content="ops"><link rel="manifest" href="/ops-manifest.webmanifest">';
const previewWorkflow = readFileSync(
  new URL("../../../.github/workflows/floor-v3-preview-audit.yml", import.meta.url),
  "utf8",
);
const productionWorkflow = readFileSync(
  new URL("../../../.github/workflows/vbackerworkflowmain.yml", import.meta.url),
  "utf8",
);

test("Build Output routes preserve filesystem before Ops and Player fallbacks", () => {
  for (const source of ["/version.json", "/sw.js", "/service-worker.js"]) {
    assert.deepEqual(
      VERCEL_BUILD_OUTPUT_ROUTES.find((route) => route.src === source),
      {
        src: source,
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
        continue: true,
      },
    );
  }
  assert.deepEqual(VERCEL_BUILD_OUTPUT_ROUTES.slice(-3), [
    { handle: "filesystem" },
    { src: "/ops(?:/.*)?", dest: "/ops.html" },
    { src: "/(.*)", dest: "/index.html" },
  ]);
});

test("generator fails closed when either application entry is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ops-routing-"));
  try {
    const staticDir = path.join(root, "static");
    await mkdir(staticDir);
    await writeFile(path.join(staticDir, "index.html"), player);
    await assert.rejects(
      writeVercelBuildOutputConfig({
        staticDir,
        output: path.join(root, "config.json"),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generator and local verifier accept two distinct shells", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ops-routing-"));
  try {
    const staticDir = path.join(root, "static");
    const output = path.join(root, "config.json");
    await mkdir(staticDir);
    await writeFile(path.join(staticDir, "index.html"), player);
    await writeFile(path.join(staticDir, "ops.html"), ops);
    await writeVercelBuildOutputConfig({ staticDir, output });
    await verifyLocal(staticDir);
    const parsed = JSON.parse(await readFile(output, "utf8"));
    assert.equal(parsed.version, 3);
    assert.deepEqual(parsed.routes, VERCEL_BUILD_OUTPUT_ROUTES);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell verifier rejects Ops HTML that registers a rescue worker", () => {
  assert.throws(() => assertShellHtml({
    playerHtml: player,
    opsHtml: `${ops}<script>registerServiceWorker()</script>`,
  }));
});

test("Preview workflow deploys and verifies a source-pinned non-production bundle", () => {
  assert.match(previewWorkflow, /github\.ref != 'refs\/heads\/main'/u);
  assert.match(previewWorkflow, /FLOOR_UAT_SUPABASE_ANON_KEY/u);
  assert.match(previewWorkflow, /write-vercel-build-output-config\.mjs/u);
  assert.match(previewWorkflow, /verify-app-shell-routing\.mjs/u);
  assert.match(previewWorkflow, /vercel deploy --prebuilt --yes --token "\$VERCEL_TOKEN"/u);
  assert.doesNotMatch(previewWorkflow, /vercel deploy[^\n]*--prod/u);
  assert.doesNotMatch(previewWorkflow, /supabase\s+(db|functions)\s+(push|deploy)/u);
});

test("production receipt waits for canonical version and both live shells", () => {
  const deploy = productionWorkflow.indexOf("vercel deploy --prebuilt --prod");
  const promote = productionWorkflow.indexOf('vercel promote "$deployment_url" --yes --token "$VERCEL_TOKEN"');
  const canonicalCheck = productionWorkflow.indexOf("canonical_verified=true");
  const receipt = productionWorkflow.indexOf("Record receipt only after successful frontend deploy");
  assert.ok(deploy > 0);
  assert.ok(promote > deploy);
  assert.ok(canonicalCheck > 0);
  assert.ok(canonicalCheck > promote);
  assert.ok(receipt > canonicalCheck);
  assert.match(productionWorkflow, /cmp --silent VinPoker\/dist\/version\.json "\$canonical_version"/u);
  assert.match(productionWorkflow, /--base-url "https:\/\/vinpoker\.vercel\.app"/u);
});
