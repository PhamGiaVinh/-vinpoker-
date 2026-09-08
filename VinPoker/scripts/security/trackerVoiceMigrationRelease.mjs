import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSIONED_MIGRATION = /^(\d{14})_.+\.sql$/u;
export const TRACKER_VOICE_RELEASE_MANIFEST =
  "tracker-voice-release-chain.manifest.json";

function sha256(path) {
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function parseManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "tracker-voice-release-chain" ||
    manifest.phase !== "SOURCE_ONLY" ||
    manifest.sourceOnly !== true ||
    !Array.isArray(manifest.chain)
  ) {
    throw new Error("unsupported Tracker Voice release manifest schema");
  }

  const filenames = new Set();
  const versions = new Set();
  let previousVersion = "";
  for (const entry of manifest.chain) {
    const match = typeof entry?.filename === "string"
      ? entry.filename.match(VERSIONED_MIGRATION)
      : null;
    if (
      !match ||
      entry.version !== match[1] ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      filenames.has(entry.filename) ||
      versions.has(entry.version) ||
      entry.version <= previousVersion
    ) {
      throw new Error("invalid Tracker Voice release chain entry");
    }
    filenames.add(entry.filename);
    versions.add(entry.version);
    previousVersion = entry.version;
  }
  if (manifest.chain.length === 0) {
    throw new Error("Tracker Voice release chain is empty");
  }
  return manifest;
}

export function evaluateTrackerVoiceRelease({ migrationDirectory, manifestPath }) {
  if (!existsSync(manifestPath)) {
    return {
      errors: ["Tracker Voice release manifest is missing"],
      filenames: new Set(),
      versions: new Set(),
    };
  }

  let manifest;
  try {
    manifest = parseManifest(manifestPath);
  } catch (error) {
    return {
      errors: [`Tracker Voice release manifest invalid: ${error instanceof Error ? error.message : String(error)}`],
      filenames: new Set(),
      versions: new Set(),
    };
  }

  const errors = [];
  for (const entry of manifest.chain) {
    const path = resolve(migrationDirectory, entry.filename);
    if (!existsSync(path)) {
      errors.push(`Tracker Voice release migration missing: ${entry.filename}`);
    } else if (sha256(path) !== entry.sha256) {
      errors.push(`Tracker Voice release migration hash drift: ${entry.filename}`);
    }
  }
  return {
    errors,
    filenames: new Set(manifest.chain.map((entry) => entry.filename)),
    versions: new Set(manifest.chain.map((entry) => entry.version)),
  };
}
