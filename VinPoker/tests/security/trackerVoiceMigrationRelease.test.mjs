import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { evaluateTrackerVoiceRelease } from "../../scripts/security/trackerVoiceMigrationRelease.mjs";

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function withRelease(files, callback) {
  const root = mkdtempSync(join(tmpdir(), "tracker-voice-release-"));
  const migrations = join(root, "migrations");
  const manifest = join(root, "manifest.json");
  try {
    mkdirSync(migrations);
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(join(root, name), source);
    }
    callback({ root, migrations, manifest });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts only an exact ordered source-only Voice release chain", () => {
  withRelease({ "migrations/20270114000004_voice.sql": "BEGIN;\nCOMMIT;\n" }, ({ migrations, manifest }) => {
    const source = "BEGIN;\nCOMMIT;\n";
    writeFileSync(manifest, JSON.stringify({
      schemaVersion: 1,
      kind: "tracker-voice-release-chain",
      phase: "SOURCE_ONLY",
      sourceOnly: true,
      chain: [{
        version: "20270114000004",
        filename: "20270114000004_voice.sql",
        sha256: sha256(source),
      }],
    }));
    const result = evaluateTrackerVoiceRelease({ migrationDirectory: migrations, manifestPath: manifest });
    assert.deepEqual(result.errors, []);
    assert.deepEqual([...result.filenames], ["20270114000004_voice.sql"]);
  });
});

test("fails closed when a released migration changes", () => {
  withRelease({ "migrations/20270114000004_voice.sql": "BEGIN;\nSELECT 1;\nCOMMIT;\n" }, ({ migrations, manifest }) => {
    writeFileSync(manifest, JSON.stringify({
      schemaVersion: 1,
      kind: "tracker-voice-release-chain",
      phase: "SOURCE_ONLY",
      sourceOnly: true,
      chain: [{
        version: "20270114000004",
        filename: "20270114000004_voice.sql",
        sha256: sha256("BEGIN;\nCOMMIT;\n"),
      }],
    }));
    const result = evaluateTrackerVoiceRelease({ migrationDirectory: migrations, manifestPath: manifest });
    assert.deepEqual(result.errors, [
      "Tracker Voice release migration hash drift: 20270114000004_voice.sql",
    ]);
  });
});
