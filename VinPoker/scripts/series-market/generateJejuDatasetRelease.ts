import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import { assembleJejuDatasetRelease, validateJejuDatasetRelease } from "../../src/lib/series-market/datasetRelease";
import {
  buildJejuDataQualityReport,
  importJejuSeed,
  type JejuSeedSourceManifest,
} from "../../src/lib/series-market/jejuSeedAdapter";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const releaseRoot = resolve(appRoot, "src/lib/series-market/datasets/jeju/v1");
const rawPath = resolve(releaseRoot, "raw/jeju_events_seed_v0.csv");
const manifestPath = resolve(releaseRoot, "source-manifest.json");
const canonicalPath = resolve(releaseRoot, "canonical/jeju_import_v1.json");
const releasePath = resolve(releaseRoot, "release.json");
const qualityPath = resolve(releaseRoot, "data-quality.json");

function stableJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

function assertEqual(actual: string | number, expected: string | number, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function artifactBytes(path: string, value: unknown): string {
  return stableJson(value);
}

function writeOrCheck(path: string, contents: string, checkOnly: boolean): void {
  if (checkOnly) {
    assertEqual(readFileSync(path, "utf8"), contents, `artifact is not reproducible: ${path}`);
    return;
  }
  writeFileSync(path, contents, "utf8");
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as JejuSeedSourceManifest;
  const rawBytes = readFileSync(rawPath);
  const rawSha256 = createHash("sha256").update(rawBytes).digest("hex");
  assertEqual(rawSha256, manifest.rawSha256, "raw source SHA-256 mismatch");
  assertEqual(rawBytes.length, manifest.byteSize, "raw source byte size mismatch");

  const { document, dataset } = await importJejuSeed(rawBytes.toString("utf8"), manifest);
  const release = await assembleJejuDatasetRelease(dataset, {
    sourceCutoff: manifest.retrievedAt,
    notes: "Unverified public Jeju seed release for importer and descriptive research testing.",
  });
  await validateJejuDatasetRelease(dataset, release);
  const quality = buildJejuDataQualityReport(dataset, manifest, release.id);

  writeOrCheck(canonicalPath, artifactBytes(canonicalPath, document), checkOnly);
  writeOrCheck(releasePath, artifactBytes(releasePath, release), checkOnly);
  writeOrCheck(qualityPath, artifactBytes(qualityPath, quality), checkOnly);
  process.stdout.write(`${checkOnly ? "Validated" : "Generated"} Jeju dataset release ${release.id}\n`);
}

await main();
