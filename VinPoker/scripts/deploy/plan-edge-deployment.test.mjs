import assert from "node:assert/strict";
import test from "node:test";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";
import { buildDeploymentPlan, isFrontendPath } from "./plan-edge-deployment.mjs";

const manifest = loadDeploymentManifest();

test("push keeps critical Edge changes dark", () => {
  const plan = buildDeploymentPlan({
    event: "push",
    changedFiles: ["VinPoker/supabase/functions/process-swing/index.ts"],
    manifest,
  });

  assert.deepEqual(plan.criticalFunctions, []);
  assert.deepEqual(plan.noncriticalFunctions, []);
  assert.deepEqual(plan.criticalChanged, ["process-swing"]);
});

test("push also holds a frontend that depends on dark critical source", () => {
  const plan = buildDeploymentPlan({
    event: "push",
    changedFiles: [
      "VinPoker/supabase/functions/checkout-dealer/index.ts",
      "VinPoker/src/components/DealerSwingTab.tsx",
    ],
    manifest,
  });

  assert.equal(plan.frontend, false);
  assert.equal(plan.frontendHeld, true);
});

test("push deploys only the changed noncritical function", () => {
  const plan = buildDeploymentPlan({
    event: "push",
    changedFiles: [
      "VinPoker/supabase/functions/assign-dealer/index.ts",
      "VinPoker/docs/dealer-swing/control-plane.md",
    ],
    manifest,
  });

  assert.deepEqual(plan.noncriticalFunctions, ["assign-dealer"]);
  assert.equal(plan.frontend, false);
});

test("shared Edge changes never fan out automatically", () => {
  const plan = buildDeploymentPlan({
    event: "push",
    changedFiles: ["VinPoker/supabase/functions/_shared/fillEmptyTables.ts"],
    manifest,
  });

  assert.equal(plan.sharedChanged, true);
  assert.deepEqual(plan.noncriticalFunctions, []);
  assert.deepEqual(plan.criticalChanged, ["checkout-dealer", "mass-assign", "process-swing"]);
});

test("manual dispatch accepts a changed critical function", () => {
  const plan = buildDeploymentPlan({
    event: "workflow_dispatch",
    changedFiles: ["VinPoker/supabase/functions/mass-assign/index.ts"],
    selected: ["mass-assign"],
    manifest,
  });

  assert.deepEqual(plan.criticalFunctions, ["mass-assign"]);
  assert.deepEqual(plan.noncriticalFunctions, []);
});

test("manual dispatch rejects an unchanged function", () => {
  assert.throws(
    () => buildDeploymentPlan({
      event: "workflow_dispatch",
      changedFiles: ["VinPoker/supabase/functions/process-swing/index.ts"],
      selected: ["mass-assign"],
      manifest,
    }),
    /did not change/,
  );
});

test("manual dispatch rejects a noncritical function", () => {
  assert.throws(
    () => buildDeploymentPlan({
      event: "workflow_dispatch",
      changedFiles: ["VinPoker/supabase/functions/assign-dealer/index.ts"],
      selected: ["assign-dealer"],
      manifest,
    }),
    /not allowed/,
  );
});

test("manual frontend deploy requires a frontend change", () => {
  assert.throws(
    () => buildDeploymentPlan({
      event: "workflow_dispatch",
      changedFiles: ["VinPoker/docs/dealer-swing/control-plane.md"],
      deployFrontend: true,
      manifest,
    }),
    /frontend source did not change/,
  );
});

test("frontend matcher excludes deployment tooling", () => {
  assert.equal(isFrontendPath("VinPoker/src/App.tsx"), true);
  assert.equal(isFrontendPath("VinPoker/package-lock.json"), true);
  assert.equal(isFrontendPath("VinPoker/scripts/deploy/validate-control-plane.mjs"), false);
});
