import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, validateDeploymentManifest } from "./deployment-manifest.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..", "..");
const workflowPath = resolve(repositoryRoot, ".github", "workflows", "vbackerworkflowmain.yml");
const validationWorkflowPath = resolve(
  repositoryRoot,
  ".github",
  "workflows",
  "deployment-control-plane-validation.yml",
);
const shortageAlertApplyWorkflowPath = resolve(
  repositoryRoot,
  ".github",
  "workflows",
  "dealer-shortage-alert-lifecycle-apply.yml",
);
const schemaCaptureWorkflowPath = resolve(repositoryRoot, ".github", "workflows", "capture-live-public-schema.yml");
const payrollDisposableWorkflowPath = resolve(
  repositoryRoot,
  ".github",
  "workflows",
  "dealer-pt-wage-disposable-validation.yml",
);
const workflow = readFileSync(workflowPath, "utf8");
const validationWorkflow = readFileSync(validationWorkflowPath, "utf8");
const shortageAlertApplyWorkflow = readFileSync(shortageAlertApplyWorkflowPath, "utf8");
const schemaCaptureWorkflow = readFileSync(schemaCaptureWorkflowPath, "utf8");
const payrollDisposableWorkflow = readFileSync(payrollDisposableWorkflowPath, "utf8");
const manifest = loadDeploymentManifest();
validateDeploymentManifest(manifest, repositoryRoot);

const forbiddenPatterns = [
  [/continue-on-error\s*:/i, "continue-on-error"],
  [/supabase\s+db\s+push/i, "broad database mutation"],
  [/--include-all\b/i, "include-all migration replay"],
  [/supabase\s+functions\s+deploy/i, "direct Edge deployment outside the manifest runner"],
  [/deploy-noncritical-edge:/i, "shared-workflow noncritical Edge auto-deploy"],
  [/target-source\/VinPoker\/scripts\/deploy/i, "deployment tooling loaded from target source"],
];
for (const [pattern, label] of forbiddenPatterns) {
  if (pattern.test(workflow)) throw new Error(`workflow contains forbidden ${label}`);
}

const requiredSnippets = [
  "workflow_dispatch:",
  "commit_sha:",
  "deployments: write",
  "git merge-base --is-ancestor",
  "path: control-plane",
  "path: target-source",
  "deployment-receipts.mjs fetch",
  "deployment-receipts.mjs record",
  "plan-edge-deployment.mjs",
  "verify-target-source.mjs",
  "target-source-policy.test.ts",
  "deno check",
  "deno test",
  "npm ci --ignore-scripts",
  "npm run build",
  "npx vitest run",
  "probe-live-schema-contracts.mjs",
  "capture-live-schema-contract-catalog.mjs",
  "verify-component-credential-scope.mjs",
  "contract_profile:",
  "contract_source_fingerprint:",
  "target-preflight:",
  "validate-critical-environment:",
  "required_reviewers",
  "environment:",
  `name: ${manifest.criticalEnvironment}`,
  "deploy-selected-edge-functions.mjs",
  "--target-root",
  "supabase db dump --linked --schema public",
  "capture-live-schema-contract-catalog.mjs",
  "--catalog",
  "needs.deploy-critical-edge.result == 'success'",
  "Record receipt only after successful Edge deploy",
  "Record receipt only after successful frontend deploy",
];
for (const snippet of requiredSnippets) {
  if (!workflow.includes(snippet)) throw new Error(`workflow is missing required control: ${snippet}`);
}

for (const match of workflow.matchAll(/probe-live-schema-contracts\.mjs([\s\S]{0,300})/g)) {
  if (!match[1].includes("--target-root")) {
    throw new Error("every live contract probe must derive its profile from exact target source");
  }
}

const validationForbiddenPatterns = [
  [/\bsecrets\./, "production secret reference"],
  [/supabase\s+(?:functions\s+deploy|db\s+(?:push|reset))/i, "production mutation"],
  [/vercel\s+(?:deploy|--prod)/i, "frontend deployment"],
];
for (const [pattern, label] of validationForbiddenPatterns) {
  if (pattern.test(validationWorkflow)) throw new Error(`actionlint workflow contains forbidden ${label}`);
}
for (const snippet of [
  "pull_request:",
  "contents: read",
  "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  "github.event.pull_request.head.sha || github.sha",
  "actionlint_1.7.7_linux_amd64.tar.gz",
  "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
  "sha256sum --check --strict",
]) {
  if (!validationWorkflow.includes(snippet)) throw new Error(`pinned actionlint validation is missing: ${snippet}`);
}

for (const [pattern, label] of [
  [/supabase\s+(?:functions\s+deploy|db\s+(?:push|reset))/i, "direct production mutation"],
  [/vercel\s+(?:deploy|--prod)/i, "frontend deployment"],
  [/20270104000005_dealer_shortage_alert_lifecycle\.sql/, "superseded alert migration path"],
  [/(?:echo|printf)\b[^\n]*(?:SUPABASE|TOKEN)|\bprintenv\b/i, "secret logging"],
]) {
  if (pattern.test(shortageAlertApplyWorkflow)) {
    throw new Error(`shortage alert apply workflow contains forbidden ${label}`);
  }
}
for (const snippet of [
  "workflow_dispatch:",
  "dealer-swing-production-critical",
  "20270104000006",
  "apply-shortage-alert-lifecycle.mjs",
  "--preflight",
  "--apply",
  "APPLY_DEALER_SHORTAGE_ALERT_20270104000006",
  "git merge-base --is-ancestor",
  "secrets.SUPABASE_PROJECT_REF",
  "secrets.SUPABASEACCESSTOKEN",
]) {
  if (!shortageAlertApplyWorkflow.includes(snippet)) {
    throw new Error(`shortage alert apply workflow is missing required control: ${snippet}`);
  }
}

for (const [pattern, label] of [
  [/pull_request:/, "automatic pull request trigger"],
  [/supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i, "production mutation"],
  [/vercel\s+(?:deploy|--prod)/i, "frontend deployment"],
]) {
  if (pattern.test(schemaCaptureWorkflow)) {
    throw new Error(`schema capture workflow contains forbidden ${label}`);
  }
}
const captureSecretLogLine = schemaCaptureWorkflow
  .split("\n")
  .find((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line) && !/sha256sum/i.test(line));
if (captureSecretLogLine) throw new Error("schema capture workflow contains forbidden secret logging");
for (const snippet of [
  "workflow_dispatch:",
  "github.ref == 'refs/heads/main'",
  "dealer-swing-production-critical",
  "required_reviewers",
  "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "supabase@2.101.0",
  "supabase db dump --linked --schema public",
  "validate-live-public-schema-artifact.mjs",
  "retention-days: 3",
  "schema_only=true",
  "data_rows_captured=false",
  "secrets_detected=false",
]) {
  if (!schemaCaptureWorkflow.includes(snippet)) {
    throw new Error(`schema capture workflow is missing required control: ${snippet}`);
  }
}
const captureSecretReferences = [...new Set(
  [...schemaCaptureWorkflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]),
)].sort();
const expectedCaptureSecrets = ["SUPABASEACCESSTOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"].sort();
if (captureSecretReferences.join(",") !== expectedCaptureSecrets.join(",")) {
  throw new Error("schema capture workflow has an unexpected credential scope");
}

for (const [pattern, label] of [
  [/\bsecrets\./, "production secret reference"],
  [/supabase\s+(?:link|db\s+(?:dump|push|reset)|functions\s+deploy)/i, "production access"],
  [/vercel\s+(?:deploy|--prod)/i, "frontend deployment"],
]) {
  if (pattern.test(payrollDisposableWorkflow)) {
    throw new Error(`payroll disposable workflow contains forbidden ${label}`);
  }
}
const disposableSecretLogLine = payrollDisposableWorkflow
  .split("\n")
  .find((line) => /\b(?:echo|printf)\b/i.test(line) && /(?:SUPABASE|TOKEN|PASSWORD)/i.test(line));
if (disposableSecretLogLine) throw new Error("payroll disposable workflow contains forbidden secret logging");
for (const snippet of [
  "workflow_dispatch:",
  "github.ref == 'refs/heads/main'",
  "dealer-swing-production-critical",
  "required_reviewers",
  "target_sha:",
  "schema_artifact_run_id:",
  "schema_artifact_name:",
  "schema_sha256:",
  "postgres: [\"16\", \"17\"]",
  "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
  "sha256sum --check --status",
  "test \"$(find \"$artifact_dir\" -maxdepth 1 -type f | wc -l | tr -d ' ')\" = \"2\"",
]) {
  if (!payrollDisposableWorkflow.includes(snippet)) {
    throw new Error(`payroll disposable workflow is missing required control: ${snippet}`);
  }
}

for (const [name] of Object.entries(manifest.functions).filter(([, item]) => item.critical)) {
  const inputName = `deploy_${name.replaceAll("-", "_")}:`;
  if (!workflow.includes(inputName)) throw new Error(`workflow is missing manual input ${inputName}`);
  if (!workflow.includes(`selected+=("${name}")`)) {
    throw new Error(`workflow manual input is not wired to deployment selection for ${name}`);
  }
}

for (const [name, config] of Object.entries(manifest.functions)) {
  if (config.autoDeployOnPush) throw new Error(`${name} must not auto-deploy from the shared workflow`);
}

const preflightIndex = workflow.indexOf("target-preflight:");
const approvalIndex = workflow.indexOf("validate-critical-environment:");
const deployIndex = workflow.indexOf("deploy-critical-edge:");
if (!(preflightIndex < approvalIndex && approvalIndex < deployIndex)) {
  throw new Error("target preflight must precede environment validation and critical deployment");
}

console.log("Deployment control-plane validation passed.");
