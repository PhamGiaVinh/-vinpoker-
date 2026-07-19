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
];
for (const [pattern, label] of forbiddenPatterns) {
  if (pattern.test(workflow)) throw new Error(`workflow contains forbidden ${label}`);
}

const requiredSnippets = [
  "workflow_dispatch:",
  "commit_sha:",
  "git merge-base --is-ancestor",
  "validate-critical-environment:",
  "required_reviewers",
  "environment:",
  `name: ${manifest.criticalEnvironment}`,
  "plan-edge-deployment.mjs",
  "probe-live-schema-contracts.mjs",
  "deploy-selected-edge-functions.mjs",
  "supabase db dump --linked --schema public",
];
for (const snippet of requiredSnippets) {
  if (!workflow.includes(snippet)) throw new Error(`workflow is missing required control: ${snippet}`);
}

for (const name of ["process-swing", "mass-assign", "checkout-dealer"]) {
  const inputName = `deploy_${name.replaceAll("-", "_")}:`;
  if (!workflow.includes(inputName)) throw new Error(`workflow is missing manual input ${inputName}`);
}

console.log("Deployment control-plane validation passed.");
