import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";
import { buildComponentDiffs, buildDeploymentPlan, isFrontendPath, renderPlanSummary, verifyCommitOnMain } from "./plan-edge-deployment.mjs";

const manifest = loadDeploymentManifest();
const TARGET = "a".repeat(40);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MASS_OPEN_SELECTION = {
  profile: "dealer_mass_open_v1",
  sourceFingerprint: `sha256:${"a".repeat(64)}`,
  evidence: { fillOpenOperationImport: ["VinPoker/supabase/functions/_shared/fillOpenOperation.ts"] },
};
const LEGACY_SELECTION = {
  profile: "dealer_swing_legacy",
  sourceFingerprint: `sha256:${"b".repeat(64)}`,
  evidence: { fillEmptyTablesImport: ["VinPoker/supabase/functions/_shared/fillEmptyTables.ts"] },
};

function diff({ frontend = false, changed = [], shared = [], missing = [] } = {}) {
  const functions = {};
  for (const name of Object.keys(manifest.functions)) {
    functions[name] = {
      baselineSha: missing.includes(name) ? null : "1".repeat(40),
      baselineSource: missing.includes(name) ? "missing" : "github_deployment_receipt",
      changed: changed.includes(name) || shared.includes(name) || missing.includes(name),
      directFiles: changed.includes(name) ? [`${manifest.functions[name].path}/index.ts`] : [],
      sharedFiles: shared.includes(name) ? ["VinPoker/supabase/functions/_shared/shared.ts"] : [],
    };
  }
  return {
    frontend: {
      baselineSha: "1".repeat(40),
      baselineSource: "github_deployment_receipt",
      changed: frontend,
      files: frontend ? ["VinPoker/src/App.tsx"] : [],
    },
    functions,
  };
}

function plan(options) {
  return buildDeploymentPlan({
    event: "workflow_dispatch",
    manifest,
    targetSha: TARGET,
    contractSelection: MASS_OPEN_SELECTION,
    ...options,
  });
}

test("manual frontend-only rejects a process-swing or mass-assign hitchhike", () => {
  assert.throws(() => plan({
    componentDiffs: diff({ frontend: true, changed: ["process-swing", "mass-assign"] }),
    deployFrontend: true,
  }), /requires all changed critical functions/);
});

test("frontend plus every required critical function is accepted", () => {
  const result = plan({
    componentDiffs: diff({ frontend: true, changed: ["process-swing", "mass-assign"] }),
    selected: ["process-swing", "mass-assign"],
    deployFrontend: true,
  });
  assert.equal(result.frontend, true);
  assert.deepEqual(result.requiredForFrontend, ["mass-assign", "process-swing"]);
});

test("pre-approval summary includes full diff, JWT, contracts and frontend reason", () => {
  const result = plan({
    componentDiffs: diff({ frontend: true, changed: ["process-swing"] }),
    selected: ["process-swing"],
    deployFrontend: true,
  });
  const summary = renderPlanSummary(result);
  assert.match(summary, /VinPoker\/supabase\/functions\/process-swing\/index\.ts/);
  assert.match(summary, /no-verify/);
  assert.match(summary, /Contracts/);
  assert.match(summary, /critical_dependencies_selected/);
  assert.match(summary, /dealer_mass_open_v1/);
  assert.match(summary, /fillOpenOperationImport/);
});

test("shared source diff requires every critical consumer before frontend", () => {
  assert.throws(() => plan({
    componentDiffs: diff({ frontend: true, shared: ["process-swing", "mass-assign", "checkout-dealer"] }),
    selected: ["process-swing"],
    deployFrontend: true,
  }), /checkout-dealer, mass-assign/);
});

test("push never deploys Edge and holds frontend with a missing receipt", () => {
  const componentDiffs = diff({ frontend: true });
  componentDiffs.frontend.baselineSha = null;
  const result = buildDeploymentPlan({
    event: "push",
    componentDiffs,
    manifest,
    targetSha: TARGET,
    contractSelection: MASS_OPEN_SELECTION,
  });
  assert.deepEqual(result.noncriticalFunctions, []);
  assert.deepEqual(result.criticalFunctions, []);
  assert.equal(result.frontend, false);
  assert.equal(result.frontendReason, "frontend_receipt_missing");
});

test("missing critical receipt fails closed for frontend", () => {
  assert.throws(() => plan({
    componentDiffs: diff({ frontend: true, missing: ["checkout-dealer"] }),
    deployFrontend: true,
  }), /checkout-dealer/);
});

test("manual dispatch rejects unchanged and noncritical functions", () => {
  assert.throws(() => plan({ componentDiffs: diff(), selected: ["mass-assign"] }), /unchanged/);
  assert.throws(() => plan({
    componentDiffs: diff({ changed: ["assign-dealer"] }),
    selected: ["assign-dealer"],
  }), /not allowed/);
});

test("frontend matcher excludes deployment tooling", () => {
  assert.equal(isFrontendPath("VinPoker/src/App.tsx"), true);
  assert.equal(isFrontendPath("VinPoker/package-lock.json"), true);
  assert.equal(isFrontendPath("VinPoker/scripts/deploy/validate-control-plane.mjs"), false);
});

test("full receipt-to-target diff catches a change hidden behind a later commit", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-plan-"));
  const runGit = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const put = (path, content) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  try {
    runGit("init", "-b", "main");
    runGit("config", "user.email", "control-plane@example.invalid");
    runGit("config", "user.name", "Control Plane Test");
    put("VinPoker/src/App.tsx", "baseline");
    put("VinPoker/supabase/functions/process-swing/index.ts", "baseline");
    put("VinPoker/supabase/functions/_shared/shared.ts", "baseline");
    runGit("add", "."); runGit("commit", "-m", "baseline");
    const baseline = runGit("rev-parse", "HEAD");
    put("VinPoker/supabase/functions/process-swing/index.ts", "critical change");
    put("VinPoker/supabase/functions/_shared/shared.ts", "shared critical change");
    runGit("add", "."); runGit("commit", "-m", "critical A");
    put("README.md", "later unrelated commit");
    runGit("add", "."); runGit("commit", "-m", "unrelated B");
    const target = runGit("rev-parse", "HEAD");
    const baselines = {
      frontend: { sha: baseline, source: "github_deployment_receipt" },
      functions: Object.fromEntries(Object.keys(manifest.functions).map((name) => [name, { sha: baseline, source: "github_deployment_receipt" }])),
    };
    const diffs = buildComponentDiffs({ repositoryRoot: root, targetSha: target, baselines, manifest, mainRef: "main" });
    assert.equal(diffs.functions["process-swing"].changed, true);
    assert.deepEqual(diffs.functions["process-swing"].directFiles, ["VinPoker/supabase/functions/process-swing/index.ts"]);
    assert.deepEqual(diffs.functions["mass-assign"].sharedFiles, ["VinPoker/supabase/functions/_shared/shared.ts"]);
    assert.equal(diffs.functions["checkout-dealer"].changed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("target commit outside main is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-main-"));
  const runGit = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    runGit("init", "-b", "main");
    runGit("config", "user.email", "control-plane@example.invalid");
    runGit("config", "user.name", "Control Plane Test");
    writeFileSync(join(root, "main.txt"), "main"); runGit("add", "."); runGit("commit", "-m", "main");
    runGit("checkout", "-b", "side");
    writeFileSync(join(root, "side.txt"), "side"); runGit("add", "."); runGit("commit", "-m", "side");
    const side = runGit("rev-parse", "HEAD");
    assert.throws(() => verifyCommitOnMain(root, side, "main"), /not reachable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-922 rollback target can be planned with current control-plane", () => {
  const currentMain = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  const baselines = {
    frontend: { sha: currentMain, source: "github_deployment_receipt" },
    functions: Object.fromEntries(Object.keys(manifest.functions).map((name) => [name, {
      sha: currentMain,
      source: "github_deployment_receipt",
    }])),
  };
  const diffs = buildComponentDiffs({
    repositoryRoot,
    targetSha: "1fdc210d4ae1689091e0ad874c559592b0ecd690",
    baselines,
    manifest,
  });
  const result = buildDeploymentPlan({
    event: "workflow_dispatch",
    componentDiffs: diffs,
    selected: ["process-swing", "mass-assign", "checkout-dealer"],
    deployFrontend: true,
    manifest,
    targetSha: "1fdc210d4ae1689091e0ad874c559592b0ecd690",
    contractSelection: LEGACY_SELECTION,
  });
  assert.equal(result.frontend, true);
  assert.deepEqual(result.criticalFunctions, ["checkout-dealer", "mass-assign", "process-swing"]);
  assert.equal(result.contractProfile, "dealer_swing_legacy");
});
