import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectOpsImportGraph } from "./check-ops-app-boundary.mjs";

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ops-boundary-"));
  await Promise.all(Object.entries(files).map(async ([relative, source]) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }));
  return root;
}

test("allows an isolated Ops dependency graph", async () => {
  const root = await fixture({
    "src/ops-main.tsx": 'import App from "@/OpsApp";',
    "src/OpsApp.tsx": 'import "@/ops/auth/OpsAuthProvider";',
    "src/ops/auth/OpsAuthProvider.tsx": "export {};",
  });
  try {
    const result = await inspectOpsImportGraph(root);
    assert.deepEqual(result.violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a transitive player-client import chain", async () => {
  const root = await fixture({
    "src/ops-main.tsx": 'import App from "@/OpsApp";',
    "src/OpsApp.tsx": 'import Page from "@/ops/Page"; export default Page;',
    "src/ops/Page.tsx": 'import { supabase } from "@/integrations/supabase/client"; export default supabase;',
    "src/integrations/supabase/client.ts": "export const supabase = {};",
  });
  try {
    const result = await inspectOpsImportGraph(root);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].at(-1), "src/integrations/supabase/client.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a transitive player Layout import chain", async () => {
  const root = await fixture({
    "src/ops-main.tsx": 'import App from "@/OpsApp";',
    "src/OpsApp.tsx": 'import Layout from "@/components/Layout"; export default Layout;',
    "src/components/Layout.tsx": "export default function Layout() { return null; }",
  });
  try {
    const result = await inspectOpsImportGraph(root);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].at(-1), "src/components/Layout.tsx");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces explicit Ops callback, local sign-out and scoped tournament preflight", async () => {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const [clientSource, authSource, callbackSource, gateSource] = await Promise.all([
    readFile(path.join(repoRoot, "src/integrations/supabase/opsClient.ts"), "utf8"),
    readFile(path.join(repoRoot, "src/ops/auth/OpsAuthProvider.tsx"), "utf8"),
    readFile(path.join(repoRoot, "src/ops/pages/OpsAuthCallback.tsx"), "utf8"),
    readFile(path.join(repoRoot, "src/ops/auth/OpsTournamentScopeGate.tsx"), "utf8"),
  ]);
  assert.match(clientSource, /detectSessionInUrl:\s*false/u);
  assert.match(authSource, /signOut\(\{\s*scope:\s*"local"\s*\}\)/u);
  assert.match(callbackSource, /callbackAttempt/u);
  assert.match(
    gateSource,
    /selectedClubId\s*&&\s*\(isSuperAdmin\s*\|\|\s*floorClubIds\.includes\(selectedClubId\)\)/u,
  );
  assert.match(gateSource, /\.eq\("club_id",\s*selectedClubId\)/u);
});
