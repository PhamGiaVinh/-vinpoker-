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
const schemaCaptureWorkflow = readFileSync(resolve(root, ".github/workflows/capture-live-public-schema.yml"), "utf8");
const payrollDisposableWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-disposable-validation.yml"),
  "utf8",
);
const payrollApplyWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-global-continuous-accrual-apply.yml"),
  "utf8",
);
const payrollReadinessAclApplyWorkflow = readFileSync(
  resolve(root, ".github/workflows/dealer-pt-wage-readiness-acl-apply.yml"),
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

test("frontend deployment is manual-only", () => {
  const frontendDeploy = workflow.slice(workflow.indexOf("deploy-frontend:"));
  assert.match(frontendDeploy, /github\.event_name == 'workflow_dispatch'/);
});

test("frontend receipt verification has a bounded Vercel alias convergence window", () => {
  const frontendDeploy = workflow.slice(workflow.indexOf("deploy-frontend:"));
  assert.match(frontendDeploy, /shell_verify_attempts=72/);
  assert.match(frontendDeploy, /shell_verify_interval_seconds=5/);
  assert.equal((frontendDeploy.match(/\$\(seq 1 "\$shell_verify_attempts"\)/gu) ?? []).length, 2);
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

test("Ops club-account deploy remains an explicit protected critical selection", () => {
  const criticalJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  assert.match(workflow, /deploy_ops_club_accounts:/);
  assert.match(workflow, /selected\+=\("ops-club-accounts"\)/);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(criticalJob, /environment:\s*\n\s*name: dealer-swing-production-critical/);
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

test("frontend-only target preflight skips the unused full schema dump but keeps the catalog gate", () => {
  const targetPreflight = workflow.slice(workflow.indexOf("target-preflight:"), workflow.indexOf("validate-critical-environment:"));
  assert.match(targetPreflight, /CRITICAL_TARGETS: \$\{\{ needs\.plan\.outputs\.critical_functions \}\}/);
  assert.match(
    targetPreflight,
    /if \[\[ "\$\{CRITICAL_TARGETS\}" != "\[\]" \]\]; then\s+# Critical Edge deployments retain the full schema dump as offline evidence\.\s+supabase db dump --linked --schema public --file "\$\{RUNNER_TEMP\}\/live-schema\.sql"\s+fi/,
  );
  assert.match(targetPreflight, /capture-live-schema-contract-catalog\.mjs/);
  assert.match(targetPreflight, /Probe frontend live contracts/);
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

test("schema capture is manual, protected, schema-only, and retains no raw output in summaries", () => {
  assert.match(schemaCaptureWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(schemaCaptureWorkflow, /pull_request:/);
  assert.match(schemaCaptureWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(schemaCaptureWorkflow, /dealer-swing-production-critical/);
  assert.match(schemaCaptureWorkflow, /required_reviewers/);
  assert.match(schemaCaptureWorkflow, /supabase db dump --linked --schema public/);
  assert.match(schemaCaptureWorkflow, /sanitize-live-public-schema-artifact\.mjs/);
  assert.match(schemaCaptureWorkflow, /validate-live-public-schema-artifact\.mjs/);
  assert.match(schemaCaptureWorkflow, /raw_schema_path="\$\{RUNNER_TEMP\}\/live-public-schema\.raw\.sql"/);
  assert.match(schemaCaptureWorkflow, /rm -f "\$\{RUNNER_TEMP\}\/live-public-schema\.raw\.sql"/);
  assert.match(schemaCaptureWorkflow, /schema_artifact_sanitized=true/);
  assert.match(schemaCaptureWorkflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(schemaCaptureWorkflow, /retention-days: 3/);
  assert.doesNotMatch(schemaCaptureWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(schemaCaptureWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    schemaCaptureWorkflow
      .split("\n")
      .some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line) && !/sha256sum/i.test(line)),
    false,
  );
});

test("payroll disposable validation requires a checksummed artifact without production access", () => {
  assert.match(payrollDisposableWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollDisposableWorkflow, /pull_request:/);
  assert.match(payrollDisposableWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollDisposableWorkflow, /schema_artifact_run_id:/);
  assert.match(payrollDisposableWorkflow, /schema_sha256:/);
  assert.match(payrollDisposableWorkflow, /postgres: \["16", "17"\]/);
  assert.match(payrollDisposableWorkflow, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
  assert.match(payrollDisposableWorkflow, /sha256sum --check --status/);
  assert.doesNotMatch(payrollDisposableWorkflow, /\bsecrets\./);
  assert.doesNotMatch(payrollDisposableWorkflow, /supabase\s+(?:link|db\s+(?:dump|push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollDisposableWorkflow, /vercel\s+(?:deploy|--prod)/i);
});

test("global PT wage apply is manual, protected, source-pinned, and dark by default", () => {
  assert.match(payrollApplyWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollApplyWorkflow, /pull_request:/);
  assert.match(payrollApplyWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollApplyWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollApplyWorkflow, /required_reviewers/);
  assert.match(payrollApplyWorkflow, /c3457d4cbd1c0b7f54917f629d15efef3637f5b9/);
  assert.match(payrollApplyWorkflow, /--preflight/);
  assert.match(payrollApplyWorkflow, /--apply/);
  assert.match(payrollApplyWorkflow, /APPLY_DEALER_PT_WAGE_GLOBAL_CONTINUOUS_ACCRUAL_V2_20270106000001/);
  assert.match(payrollApplyWorkflow, /--source-root/);
  assert.match(payrollApplyWorkflow, /git -C control-plane merge-base --is-ancestor/);
  assert.match(payrollApplyWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(payrollApplyWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollApplyWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    payrollApplyWorkflow.split("\n").some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line)),
    false,
  );
});

test("readiness ACL repair apply is manual, protected, source-pinned, and cannot widen rollout", () => {
  assert.match(payrollReadinessAclApplyWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /pull_request:/);
  assert.match(payrollReadinessAclApplyWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(payrollReadinessAclApplyWorkflow, /dealer-swing-production-critical/);
  assert.match(payrollReadinessAclApplyWorkflow, /required_reviewers/);
  assert.match(payrollReadinessAclApplyWorkflow, /6939b6d72c9533ce68101624b22e7a5be73d3b83/);
  assert.match(payrollReadinessAclApplyWorkflow, /--preflight/);
  assert.match(payrollReadinessAclApplyWorkflow, /--apply/);
  assert.match(payrollReadinessAclApplyWorkflow, /APPLY_DEALER_PT_WAGE_READINESS_ACL_20270106000002/);
  assert.match(payrollReadinessAclApplyWorkflow, /--source-root/);
  assert.match(payrollReadinessAclApplyWorkflow, /git -C control-plane merge-base --is-ancestor/);
  assert.match(payrollReadinessAclApplyWorkflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(payrollReadinessAclApplyWorkflow, /vercel\s+(?:deploy|--prod)/i);
  assert.equal(
    payrollReadinessAclApplyWorkflow.split("\n").some((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line)),
    false,
  );
});
