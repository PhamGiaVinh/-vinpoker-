import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(resolve(root, ".github/workflows/vbackerworkflowmain.yml"), "utf8");

test("frontend cannot run after a required critical deployment failure", () => {
  assert.match(workflow, /needs\.plan\.outputs\.critical_functions == '\[\]' \|\| needs\.deploy-critical-edge\.result == 'success'/);
  assert.match(workflow, /needs\.target-preflight\.result == 'success'/);
});

test("control-plane tooling and target source use separate checkouts", () => {
  assert.match(workflow, /path: control-plane/);
  assert.match(workflow, /path: target-source/);
  assert.doesNotMatch(workflow, /target-source\/VinPoker\/scripts\/deploy/);
});

test("receipts are written only after their corresponding deployment step", () => {
  const edgeDeploy = workflow.indexOf("Deploy only this exact target function");
  const edgeReceipt = workflow.indexOf("Record receipt only after successful Edge deploy");
  const frontendDeploy = workflow.indexOf("Deploy prebuilt bundle to Vercel");
  const frontendReceipt = workflow.indexOf("Record receipt only after successful frontend deploy");
  assert.equal(edgeDeploy > -1 && edgeReceipt > edgeDeploy, true);
  assert.equal(frontendDeploy > -1 && frontendReceipt > frontendDeploy, true);
});

test("shared workflow has no automatic Edge deployment path", () => {
  assert.doesNotMatch(workflow, /deploy-noncritical-edge:/);
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/);
});
