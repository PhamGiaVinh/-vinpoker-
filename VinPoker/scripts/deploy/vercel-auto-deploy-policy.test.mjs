import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const applicationRoot = resolve(repositoryRoot, "VinPoker");
const configPath = resolve(applicationRoot, "vercel.json");
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/vbackerworkflowmain.yml"),
  "utf8",
);

function assertNoCredentialKeys(value, path = "vercel.json") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialKeys(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /token|secret|password|authorization|api[-_]?key/i, `${path} must not contain credentials`);
      assertNoCredentialKeys(child, `${path}.${key}`);
    }
  }
}

test("Vercel Git deployment is disabled from the configured VinPoker project root", () => {
  assert.equal(existsSync(configPath), true);
  assert.equal(existsSync(resolve(repositoryRoot, "vercel.json")), false);

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(config.git?.deploymentEnabled, false);
  assertNoCredentialKeys(config);
});

test("production workflow does not rewrite Git deployment policy", () => {
  assert.doesNotMatch(workflow, /vercel\.json|deploymentEnabled/);
});

test("Vercel CLI remains limited to the explicit frontend deployment path", () => {
  const edgeJob = workflow.slice(
    workflow.indexOf("deploy-critical-edge:"),
    workflow.indexOf("deploy-frontend:"),
  );
  const frontendJob = workflow.slice(workflow.indexOf("deploy-frontend:"));

  assert.match(workflow, /DEPLOY_FRONTEND: \$\{\{ inputs\.deploy_frontend \|\| false \}\}/);
  assert.match(workflow, /--deploy-frontend "\$DEPLOY_FRONTEND"/);
  assert.doesNotMatch(edgeJob, /\bvercel\b/i);
  assert.match(frontendJob, /needs\.plan\.outputs\.frontend == 'true'/);
  assert.match(frontendJob, /vercel deploy --prebuilt --prod/);
});
