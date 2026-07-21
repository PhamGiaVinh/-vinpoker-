import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(resolve(root, ".github/workflows/vbackerworkflowmain.yml"), "utf8");
const validationWorkflow = readFileSync(
  resolve(root, ".github/workflows/deployment-control-plane-validation.yml"),
  "utf8",
);

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

test("Floor clock deploy remains an explicit protected critical selection", () => {
  const criticalJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  assert.match(workflow, /deploy_tournament_live_clock:/);
  assert.match(workflow, /selected\+=\("tournament-live-clock"\)/);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(
    criticalJob,
    /needs:\s*\n\s*- plan\s*\n\s*- target-preflight\s*\n\s*- validate-critical-environment/,
  );
});

test("every live probe derives its profile from the exact target checkout", () => {
  const probes = [...workflow.matchAll(/probe-live-schema-contracts\.mjs([\s\S]{0,300})/g)];
  assert.equal(probes.length, 4);
  for (const probe of probes) assert.match(probe[1], /--target-root/);
  assert.doesNotMatch(workflow, /inputs\.contract_profile|CONTRACT_PROFILE_OVERRIDE|--profile\b/i);
  assert.match(workflow, /contract_profile: \$\{\{ steps\.plan\.outputs\.contract_profile \}\}/);
});

test("live contract approval uses the read-only catalog instead of parsing a raw SQL dump", () => {
  assert.match(workflow, /capture-live-schema-contract-catalog\.mjs/);
  const probes = [...workflow.matchAll(/probe-live-schema-contracts\.mjs([\s\S]{0,300})/g)];
  assert.equal(probes.length, 4);
  for (const probe of probes) assert.match(probe[1], /--catalog/);
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.doesNotMatch(targetPreflight, /VERCEL_TOKEN|VERCELTOKEN/);
  assert.match(workflow, /deploy-frontend:[\s\S]*Verify frontend scoped credentials[\s\S]*VERCEL_TOKEN/);
});

test("target preflight invokes catalog tooling from the control-plane checkout", () => {
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.match(
    targetPreflight,
    /node "\$\{GITHUB_WORKSPACE\}\/control-plane\/VinPoker\/scripts\/deploy\/capture-live-schema-contract-catalog\.mjs"/,
  );
  assert.doesNotMatch(targetPreflight, /node control-plane\/VinPoker\/scripts\/deploy\/capture-live-schema-contract-catalog\.mjs/);
});

test("profile-specific Deno tests run only for the exact derived target contract", () => {
  const stepStart = workflow.indexOf("- name: Run current policy and target Deno tests");
  const stepEnd = workflow.indexOf("\n      - name:", stepStart + 1);
  const denoTestStep = workflow.slice(stepStart, stepEnd);

  assert.notEqual(stepStart, -1);
  assert.notEqual(stepEnd, -1);
  assert.match(
    denoTestStep,
    /env:\s*[\s\S]*CONTRACT_PROFILE: \$\{\{ needs\.plan\.outputs\.contract_profile \}\}/,
  );
  assert.match(denoTestStep, /--arg profile "\$CONTRACT_PROFILE"/);
  assert.match(denoTestStep, /denoTestsByContractProfile\[\$profile\]/);
});

test("pinned actionlint validation is read-only and uses no production secret", () => {
  assert.match(validationWorkflow, /pull_request:/);
  assert.match(validationWorkflow, /contents: read/);
  assert.match(validationWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(validationWorkflow, /actionlint_1\.7\.7_linux_amd64\.tar\.gz/);
  assert.match(validationWorkflow, /023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757/);
  assert.match(validationWorkflow, /sha256sum --check --strict/);
  assert.match(validationWorkflow, /\.github\/workflows\/vbackerworkflowmain\.yml/);
  assert.match(validationWorkflow, /\.github\/workflows\/deployment-control-plane-validation\.yml/);
  assert.doesNotMatch(validationWorkflow, /find \.github\/workflows/);
  assert.doesNotMatch(validationWorkflow, /\bsecrets\./);
  assert.doesNotMatch(validationWorkflow, /supabase\s+(?:functions\s+deploy|db\s+(?:push|reset))/i);
  assert.doesNotMatch(validationWorkflow, /vercel\s+(?:deploy|--prod)/i);
});
