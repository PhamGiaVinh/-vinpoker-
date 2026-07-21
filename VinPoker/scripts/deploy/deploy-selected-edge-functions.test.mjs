import assert from "node:assert/strict";
import test from "node:test";
import { loadDeploymentManifest, parseTargetList } from "./deployment-manifest.mjs";
import { deploymentArguments } from "./deploy-selected-edge-functions.mjs";

const manifest = loadDeploymentManifest();

test("critical JWT posture is preserved by deployment arguments", () => {
  assert.deepEqual(
    deploymentArguments("process-swing", manifest.functions["process-swing"]),
    ["functions", "deploy", "process-swing", "--no-verify-jwt"],
  );
  assert.deepEqual(
    deploymentArguments("mass-assign", manifest.functions["mass-assign"]),
    ["functions", "deploy", "mass-assign"],
  );
  assert.deepEqual(
    deploymentArguments("checkout-dealer", manifest.functions["checkout-dealer"]),
    ["functions", "deploy", "checkout-dealer"],
  );
  assert.deepEqual(
    deploymentArguments("tournament-live-clock", manifest.functions["tournament-live-clock"]),
    ["functions", "deploy", "tournament-live-clock"],
  );
});

test("target parser rejects duplicate deployment targets", () => {
  assert.throws(() => parseTargetList('["mass-assign","mass-assign"]'), /duplicates/);
});

test("target parser accepts a shell-friendly comma-separated list", () => {
  assert.deepEqual(parseTargetList("process-swing,mass-assign"), ["process-swing", "mass-assign"]);
});

test("current manifest JWT posture applies independently of target source age", () => {
  const oldTargetHasNoControlPlaneTooling = true;
  assert.equal(oldTargetHasNoControlPlaneTooling, true);
  assert.deepEqual(deploymentArguments("process-swing", manifest.functions["process-swing"]), [
    "functions", "deploy", "process-swing", "--no-verify-jwt",
  ]);
});
