import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, validateDeploymentManifest } from "./deployment-manifest.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..", "..");
const workflowPath = resolve(repositoryRoot, ".github", "workflows", "vbackerworkflowmain.yml");
const workflow = readFileSync(workflowPath, "utf8");
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
  "target-preflight:",
  "validate-critical-environment:",
  "required_reviewers",
  "environment:",
  `name: ${manifest.criticalEnvironment}`,
  "deploy-selected-edge-functions.mjs",
  "--target-root",
  "supabase db dump --linked --schema public",
  "needs.deploy-critical-edge.result == 'success'",
  "Record receipt only after successful Edge deploy",
  "Record receipt only after successful frontend deploy",
];
for (const snippet of requiredSnippets) {
  if (!workflow.includes(snippet)) throw new Error(`workflow is missing required control: ${snippet}`);
}

for (const name of ["process-swing", "mass-assign", "checkout-dealer"]) {
  const inputName = `deploy_${name.replaceAll("-", "_")}:`;
  if (!workflow.includes(inputName)) throw new Error(`workflow is missing manual input ${inputName}`);
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
