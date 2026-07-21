import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";
import { inspectTargetSource } from "./verify-target-source.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..", "..");
const manifest = loadDeploymentManifest();

function put(root, path, content = "") {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

test("target without deployment tooling can still be inspected from current control-plane", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-old-target-"));
  try {
    put(root, "VinPoker/supabase/functions/process-swing/index.ts", 'import "../_shared/helper.ts";\n');
    put(root, "VinPoker/supabase/functions/_shared/helper.ts", "export const ok = true;\n");
    for (const path of manifest.functions["process-swing"].quality.denoTests) put(root, path, "Deno.test('ok', () => {});\n");
    const report = inspectTargetSource({ targetRoot: root, targets: ["process-swing"], manifest });
    assert.equal(report.functions["process-swing"].verifyJwt, false);
    assert.equal(report.functions["process-swing"].importedFiles.includes("VinPoker/scripts/deploy"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing target function fails before deploy", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-missing-target-"));
  try {
    assert.throws(() => inspectTargetSource({ targetRoot: root, targets: ["mass-assign"], manifest }), /directory is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("target config cannot weaken current JWT posture", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-jwt-target-"));
  try {
    put(root, "VinPoker/supabase/functions/mass-assign/index.ts", "export {};\n");
    for (const path of manifest.functions["mass-assign"].quality.denoTests) put(root, path, "Deno.test('ok', () => {});\n");
    put(root, "VinPoker/supabase/config.toml", "[functions.mass-assign]\nverify_jwt = false\n");
    assert.throws(() => inspectTargetSource({ targetRoot: root, targets: ["mass-assign"], manifest }), /conflicting with the current manifest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Floor clock target includes its policy seam and keeps JWT verification", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-clock-target-"));
  try {
    put(
      root,
      "VinPoker/supabase/functions/tournament-live-clock/index.ts",
      'import "./controlPolicy.ts";\n',
    );
    put(
      root,
      "VinPoker/supabase/functions/tournament-live-clock/controlPolicy.ts",
      "export const ok = true;\n",
    );
    for (const path of manifest.functions["tournament-live-clock"].quality.denoTests) {
      put(root, path, "Deno.test('ok', () => {});\n");
    }
    const report = inspectTargetSource({
      targetRoot: root,
      targets: ["tournament-live-clock"],
      manifest,
    });
    assert.equal(report.functions["tournament-live-clock"].verifyJwt, true);
    assert.equal(
      report.functions["tournament-live-clock"].importedFiles.includes(
        "VinPoker/supabase/functions/tournament-live-clock/controlPolicy.ts",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-922 rollback source is inspectable even though it has no control-plane directory", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-pre922-"));
  const archive = join(root, "source.tar");
  const source = join(root, "source");
  mkdirSync(source);
  try {
    execFileSync("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${archive}`, "1fdc210d4ae1689091e0ad874c559592b0ecd690"]);
    execFileSync("tar", ["-xf", archive, "-C", source]);
    assert.equal(existsAt(source, "VinPoker/scripts/deploy"), false);
    const report = inspectTargetSource({
      targetRoot: source,
      targets: ["process-swing", "mass-assign", "checkout-dealer"],
      manifest,
    });
    assert.deepEqual(Object.keys(report.functions).sort(), ["checkout-dealer", "mass-assign", "process-swing"]);
    // The current control-plane owns the quality command. Do not let an old
    // target's workspace-level Deno config require a node_modules tree that is
    // intentionally absent from the exact git archive under review.
    execFileSync("deno", ["check", "--no-config", join(source, report.functions["process-swing"].entrypoint)], {
      stdio: "pipe",
      timeout: 180_000,
    });
    const tests = [...new Set(Object.values(report.functions).flatMap((item) => item.denoTests))]
      .map((path) => join(source, path));
    execFileSync("deno", ["test", "--no-config", "--allow-env", "--allow-net", "--allow-read", ...tests], {
      stdio: "pipe",
      timeout: 180_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function existsAt(root, path) {
  return existsSync(join(root, path));
}
