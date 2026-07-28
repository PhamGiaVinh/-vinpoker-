import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import { importJejuSeed, type JejuSeedSourceManifest } from "../../src/lib/series-market/jejuSeedAdapter";
import {
  createPublicSourceCoverageArtifact,
  createPublicSourceCoverageReceipt,
} from "../../src/lib/series-market/publicSourceCoverage";
import type { DatasetRelease } from "../../src/lib/series-market/contracts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const releaseRoot = resolve(appRoot, "src/lib/series-market/datasets/jeju/v1");
const rawPath = resolve(releaseRoot, "raw/jeju_events_seed_v0.csv");
const manifestPath = resolve(releaseRoot, "source-manifest.json");
const canonicalPath = resolve(releaseRoot, "canonical/jeju_import_v1.json");
const releasePath = resolve(releaseRoot, "release.json");
const artifactPath = resolve(releaseRoot, "research/public-source-coverage-v1.json");
const receiptPath = resolve(releaseRoot, "research/public-source-coverage-v1.receipt.json");

function stableJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

function writeOrCheck(path: string, contents: string, checkOnly: boolean): void {
  if (checkOnly) {
    if (readFileSync(path, "utf8") !== contents) throw new Error(`artifact is not reproducible: ${path}`);
    return;
  }
  writeFileSync(path, contents, "utf8");
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  if (process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("unsupported option; only --check is accepted");
  }
  const raw = readFileSync(rawPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as JejuSeedSourceManifest;
  const release = JSON.parse(readFileSync(releasePath, "utf8")) as DatasetRelease;
  const { dataset } = await importJejuSeed(raw, manifest);
  const artifact = await createPublicSourceCoverageArtifact({
    release,
    scope: {
      marketKey: "jeju",
      scopeKind: "defined_market",
      scopeDefinition: "Jeju-only public live-poker event corpus.",
    },
    entities: [...dataset.festivals, ...dataset.events],
    claims: dataset.claims,
    conflicts: dataset.conflicts,
  });
  const artifactBytes = stableJson(artifact);
  const artifactFileSha256 = createHash("sha256").update(artifactBytes, "utf8").digest("hex");
  const receipt = await createPublicSourceCoverageReceipt({
    artifact,
    artifactPath: "src/lib/series-market/datasets/jeju/v1/research/public-source-coverage-v1.json",
    artifactFileSha256,
  });
  writeOrCheck(artifactPath, artifactBytes, checkOnly);
  writeOrCheck(receiptPath, stableJson(receipt), checkOnly);
  process.stdout.write(`${checkOnly ? "Validated" : "Generated"} public source coverage ${artifact.artifactId}\n`);
}

await main();
