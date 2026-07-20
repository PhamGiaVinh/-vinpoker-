import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectProcessSwingLeaseSafetyContract } from "./process-swing-lease-safety-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function put(root, file, content) {
  const fullPath = join(root, file);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function helperSource() {
  return `
export class LockOwnershipLost extends Error {}
export async function ensureLockOwnership(admin, clubId) {
  const { data, error } = await admin.rpc();
  if (error) { throw new LockOwnershipLost(clubId, "lease_check_failed"); }
  if (data !== true) { throw new LockOwnershipLost(clubId, "lease_reclaimed"); }
}
export function assessLockOwnershipLoss() {
  return { dispatchState: "locked", fallbackState: "business_failed" };
}
`;
}

function handlerSource({ includeContract = true, legacyComment = false } = {}) {
  if (!includeContract) return legacyComment ? "// aborting before mutation\n" : "export const handler = true;\n";
  return `
import { ensureLockOwnership, LockOwnershipLost, assessLockOwnershipLoss } from "./executionSafety.ts";
async function run() {
  await ensureLockOwnership();
  try { await execute(); } catch (err) {
    if (err instanceof Error) {}
    else if (err instanceof LockOwnershipLost) {
      const ownershipOutcome = assessLockOwnershipLoss(err);
      recordDispatchSafetyOutcome(cid, ownershipOutcome);
    }
  }
}
`;
}

function makeFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "process-swing-lease-contract-"));
  put(root, "supabase/functions/process-swing/executionSafety.ts", options.helper ?? helperSource());
  put(root, "supabase/functions/process-swing/index.ts", options.handler ?? handlerSource(options));
  const tests = options.includeTest === false ? [] : ["VinPoker/supabase/functions/process-swing/executionSafety.test.ts"];
  put(root, "scripts/deploy/deployment-contracts.json", JSON.stringify({
    functions: {
      "process-swing": {
        quality: {
          denoTests: [],
          denoTestsByContractProfile: { dealer_mass_open_v1: tests },
        },
      },
    },
  }));
  return root;
}

function failingLabels(root) {
  return inspectProcessSwingLeaseSafetyContract(root).filter((entry) => !entry.ok).map((entry) => entry.label);
}

test("an old comment cannot satisfy a missing lease-safety contract", () => {
  const root = makeFixture({
    includeContract: false,
    legacyComment: true,
    helper: "export const oldCommentOnly = true;\n",
  });
  try {
    assert.ok(failingLabels(root).includes("process-swing exposes typed lock-ownership safety primitives"));
    assert.ok(failingLabels(root).includes("process-swing records lease-loss outcomes without finalizing the club as completed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real contract passes without the old comment", () => {
  const root = makeFixture();
  try {
    assert.deepEqual(failingLabels(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing executionSafety test registration fails the verifier", () => {
  const root = makeFixture({ includeTest: false });
  try {
    assert.ok(failingLabels(root).includes("control-plane runs executionSafety lease-failure tests for the mass-open process-swing profile"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a helper without handler catch and outcome mapping fails the verifier", () => {
  const root = makeFixture({ includeContract: false });
  try {
    assert.ok(failingLabels(root).includes("process-swing records lease-loss outcomes without finalizing the club as completed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reviewed runtime source satisfies the contract and existing hardening checks", () => {
  assert.deepEqual(failingLabels(repositoryRoot), []);
  execFileSync(process.execPath, ["scripts/verify_dealer_swing_critical_hardening.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
});
