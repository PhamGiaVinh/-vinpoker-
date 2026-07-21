import assert from "node:assert/strict";
import test from "node:test";
import { deployAndRecordReceipt, recordSuccessfulReceipt, selectLatestSuccessfulReceipt } from "./deployment-receipts.mjs";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";

const SHA_OLD = "1".repeat(40);
const SHA_NEW = "2".repeat(40);

test("latest successful receipt ignores newer failed deployment", () => {
  const statuses = new Map([
    ["20", [{ state: "failure" }]],
    ["10", [{ state: "success" }]],
  ]);
  assert.equal(selectLatestSuccessfulReceipt([
    { id: 10, sha: SHA_OLD, created_at: "2026-07-19T00:00:00Z" },
    { id: 20, sha: SHA_NEW, created_at: "2026-07-20T00:00:00Z" },
  ], statuses).sha, SHA_OLD);
});

test("failed deploy cannot write a receipt", async () => {
  let recorded = false;
  await assert.rejects(deployAndRecordReceipt({
    deploy: async () => { throw new Error("deploy failed"); },
    record: async () => { recorded = true; },
  }), /deploy failed/);
  assert.equal(recorded, false);
});

test("successful deployment writes only the selected component receipt", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 201, json: async () => ({ id: 77 }) };
  };
  await recordSuccessfulReceipt({
    repository: "owner/repo",
    token: "test-only-token",
    component: "mass-assign",
    targetSha: SHA_NEW,
    manifest: loadDeploymentManifest(),
    fetchImpl,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.environment, "receipt-vinpoker-edge-mass-assign");
  assert.equal(requests[0].body.ref, SHA_NEW);
});

test("rollback receipt may move one component to an older exact SHA", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(options.body ? JSON.parse(options.body) : null);
    return { ok: true, status: 201, json: async () => ({ id: 88 }) };
  };
  await recordSuccessfulReceipt({
    repository: "owner/repo",
    token: "test-only-token",
    component: "process-swing",
    targetSha: SHA_OLD,
    manifest: loadDeploymentManifest(),
    fetchImpl,
  });
  assert.equal(requests[0].ref, SHA_OLD);
  assert.equal(requests[0].environment, "receipt-vinpoker-edge-process-swing");
});

test("Floor clock writes its own component receipt", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(options.body ? JSON.parse(options.body) : null);
    return { ok: true, status: 201, json: async () => ({ id: 99 }) };
  };
  await recordSuccessfulReceipt({
    repository: "owner/repo",
    token: "test-only-token",
    component: "tournament-live-clock",
    targetSha: SHA_NEW,
    manifest: loadDeploymentManifest(),
    fetchImpl,
  });
  assert.equal(requests[0].ref, SHA_NEW);
  assert.equal(requests[0].environment, "receipt-vinpoker-edge-tournament-live-clock");
});
