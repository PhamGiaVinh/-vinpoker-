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
  requirements: { floorClockRevisionV1: false },
};
const LEGACY_SELECTION = {
  profile: "dealer_swing_legacy",
  sourceFingerprint: `sha256:${"b".repeat(64)}`,
  evidence: { fillEmptyTablesImport: ["VinPoker/supabase/functions/_shared/fillEmptyTables.ts"] },
  requirements: { floorClockRevisionV1: false },
};
const FLOOR_CLOCK_REVISION_SELECTION = {
  ...MASS_OPEN_SELECTION,
  requirements: { floorClockRevisionV1: true },
};

function diff({
  frontend = false,
  changed = [],
  shared = [],
  missing = [],
  retainedClockCompatibility = true,
} = {}) {
  const functions = {};
  for (const [name, config] of Object.entries(manifest.functions)) {
    const missingReceipt = missing.includes(name);
    const gate = config.retainedFrontendCompatibility;
    functions[name] = {
      baselineSha: missingReceipt ? null : "1".repeat(40),
      baselineSource: missingReceipt ? "missing" : "github_deployment_receipt",
      changed: changed.includes(name) || shared.includes(name) || missingReceipt,
      directFiles: changed.includes(name) ? [`${manifest.functions[name].path}/index.ts`] : [],
      sharedFiles: shared.includes(name) ? ["VinPoker/supabase/functions/_shared/shared.ts"] : [],
      retainedCompatibility: gate ? {
        requirement: gate.requirement,
        whenTargetRequirement: gate.whenTargetRequirement,
        satisfied: !missingReceipt && retainedClockCompatibility,
        evidenceFiles: !missingReceipt && retainedClockCompatibility
          ? gate.files.map((file) => file.path)
          : [],
        missingEvidenceFiles: !missingReceipt && retainedClockCompatibility
          ? []
          : gate.files.map((file) => file.path),
      } : null,
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

test("clock source and frontend cannot deploy until the critical clock function is selected", () => {
  const componentDiffs = diff({ frontend: true, changed: ["tournament-live-clock"] });
  assert.throws(() => plan({
    componentDiffs,
    deployFrontend: true,
    contractSelection: FLOOR_CLOCK_REVISION_SELECTION,
  }), /tournament-live-clock/);

  const result = plan({
    componentDiffs,
    selected: ["tournament-live-clock"],
    deployFrontend: true,
    contractSelection: FLOOR_CLOCK_REVISION_SELECTION,
  });
  assert.equal(result.frontend, true);
  assert.deepEqual(result.requiredForFrontend, ["tournament-live-clock"]);
  assert.deepEqual(result.criticalFunctions, ["tournament-live-clock"]);
});

test("legacy frontend fails closed without a compatible retained clock receipt", () => {
  const componentDiffs = diff({ frontend: true, retainedClockCompatibility: false });
  assert.throws(() => plan({
    componentDiffs,
    deployFrontend: true,
    contractSelection: LEGACY_SELECTION,
  }), /retained deployed compatibility evidence.*tournament-live-clock/);

  const pushResult = buildDeploymentPlan({
    event: "push",
    componentDiffs,
    manifest,
    targetSha: TARGET,
    contractSelection: LEGACY_SELECTION,
  });
  assert.equal(pushResult.frontend, false);
  assert.equal(pushResult.frontendReason, "retained_compatibility_missing");
  assert.deepEqual(pushResult.missingRetainedForFrontend, ["tournament-live-clock"]);

  assert.throws(() => plan({
    componentDiffs: diff({ frontend: true, missing: ["tournament-live-clock"] }),
    deployFrontend: true,
    contractSelection: LEGACY_SELECTION,
  }), /retained deployed compatibility evidence.*tournament-live-clock/);
});

test("legacy frontend retains the compatible clock Edge and rejects deploying its historical source", () => {
  const componentDiffs = diff({ frontend: true, changed: ["tournament-live-clock"] });
  const result = plan({
    componentDiffs,
    deployFrontend: true,
    contractSelection: LEGACY_SELECTION,
  });
  assert.equal(result.frontend, true);
  assert.deepEqual(result.retainedForFrontend, ["tournament-live-clock"]);
  assert.deepEqual(result.criticalFunctions, []);

  assert.throws(() => plan({
    componentDiffs,
    selected: ["tournament-live-clock"],
    deployFrontend: true,
    contractSelection: LEGACY_SELECTION,
  }), /must retain the compatible deployed Edge receipt/);
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

test("retained compatibility is derived from exact receipt source, not historical target source", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-retained-clock-"));
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
    put("VinPoker/src/App.tsx", "receipt frontend");
    put(
      "VinPoker/supabase/functions/tournament-live-clock/index.ts",
      "readLegacyControlRevision(request); floor_control_tournament_clock",
    );
    put(
      "VinPoker/supabase/functions/tournament-live-clock/controlPolicy.ts",
      "export function readLegacyControlRevision() {}",
    );
    runGit("add", "."); runGit("commit", "-m", "compatible deployed receipt");
    const receipt = runGit("rev-parse", "HEAD");

    put("VinPoker/src/App.tsx", "historical frontend target");
    put("VinPoker/supabase/functions/tournament-live-clock/index.ts", "legacy clock source");
    put("VinPoker/supabase/functions/tournament-live-clock/controlPolicy.ts", "legacy policy source");
    runGit("add", "."); runGit("commit", "-m", "historical target fixture");
    const target = runGit("rev-parse", "HEAD");
    const baselines = {
      frontend: { sha: receipt, source: "github_deployment_receipt" },
      functions: Object.fromEntries(Object.keys(manifest.functions).map((name) => [name, {
        sha: receipt,
        source: "github_deployment_receipt",
      }])),
    };
    const componentDiffs = buildComponentDiffs({
      repositoryRoot: root,
      targetSha: target,
      baselines,
      manifest,
      mainRef: "main",
    });
    assert.equal(componentDiffs.functions["tournament-live-clock"].retainedCompatibility.satisfied, true);
    assert.deepEqual(
      componentDiffs.functions["tournament-live-clock"].retainedCompatibility.evidenceFiles,
      manifest.functions["tournament-live-clock"].retainedFrontendCompatibility.files.map((file) => file.path),
    );
    const result = buildDeploymentPlan({
      event: "workflow_dispatch",
      componentDiffs,
      deployFrontend: true,
      manifest,
      targetSha: target,
      contractSelection: LEGACY_SELECTION,
    });
    assert.equal(result.frontend, true);
    assert.deepEqual(result.retainedForFrontend, ["tournament-live-clock"]);
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
  assert.equal(diffs.functions["tournament-live-clock"].retainedCompatibility.satisfied, false);
  assert.throws(() => buildDeploymentPlan({
    event: "workflow_dispatch",
    componentDiffs: diffs,
    selected: ["process-swing", "mass-assign", "checkout-dealer"],
    deployFrontend: true,
    manifest,
    targetSha: "1fdc210d4ae1689091e0ad874c559592b0ecd690",
    contractSelection: LEGACY_SELECTION,
  }), /retained deployed compatibility evidence/);

  diffs.functions["tournament-live-clock"].retainedCompatibility = {
    ...diffs.functions["tournament-live-clock"].retainedCompatibility,
    satisfied: true,
    evidenceFiles: manifest.functions["tournament-live-clock"].retainedFrontendCompatibility.files
      .map((file) => file.path),
    missingEvidenceFiles: [],
  };
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
