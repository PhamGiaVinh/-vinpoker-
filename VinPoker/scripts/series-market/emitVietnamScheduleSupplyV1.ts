import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import {
  createScheduleSupplyReceipt,
  createVietnamScheduleSupplyBundle,
} from "../../src/lib/series-market/vietnamScheduleSupply";
import {
  VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
  VIETNAM_SCHEDULE_SUPPLY_V1_SOURCE_CUTOFF,
  VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
} from "../../src/lib/series-market/vietnamScheduleSupplySeed";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const releaseRoot = resolve(
  appRoot,
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1",
);
const sourceManifestPath = resolve(releaseRoot, "source-manifest.json");
const inclusionManifestPath = resolve(releaseRoot, "inclusion-manifest.json");
const canonicalPath = resolve(releaseRoot, "canonical/schedule-events-v1.json");
const releasePath = resolve(releaseRoot, "release.json");
const artifactPath = resolve(releaseRoot, "research/schedule-supply-v1.json");
const receiptPath = resolve(releaseRoot, "research/schedule-supply-v1.receipt.json");
const artifactRepositoryPath =
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.json";

function stableJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeOrCheck(path: string, contents: string, checkOnly: boolean): void {
  if (checkOnly) {
    if (readFileSync(path, "utf8") !== contents) {
      throw new Error(`artifact is not reproducible: ${path}`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function verifySourceImages(): void {
  if (VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES.length !== 3) {
    throw new Error("Vietnam Schedule Supply V1 requires exactly three source images");
  }
  const observedHashes = new Set<string>();
  for (const source of VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES) {
    const sourcePath = resolve(appRoot, source.sourcePath);
    const bytes = readFileSync(sourcePath);
    const observedHash = sha256(bytes);
    if (observedHash !== source.sourceSha256) {
      throw new Error(`source image hash mismatch: ${source.sourcePath}`);
    }
    if (bytes.byteLength.toString() !== source.sourceByteLength) {
      throw new Error(`source image byte length mismatch: ${source.sourcePath}`);
    }
    if (observedHashes.has(observedHash)) {
      throw new Error(`duplicate source image bytes: ${source.sourcePath}`);
    }
    observedHashes.add(observedHash);
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  if (process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("unsupported option; only --check is accepted");
  }

  verifySourceImages();
  const bundle = await createVietnamScheduleSupplyBundle({
    sourceCutoff: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCE_CUTOFF,
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
    events: VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
  });
  const sourceManifest = {
    contractVersion: bundle.release.contractVersion,
    releaseId: bundle.release.releaseId,
    sourceCutoff: bundle.release.sourceCutoff,
    evidenceQuality: bundle.release.evidenceQuality,
    sources: bundle.artifact.sourceInventory,
  };
  const canonicalDataset = {
    contractVersion: bundle.release.contractVersion,
    releaseId: bundle.release.releaseId,
    sourceCutoff: bundle.release.sourceCutoff,
    eventCount: bundle.artifact.eventCount,
    claimCount: bundle.artifact.claimCount,
    events: bundle.artifact.events,
    claims: bundle.artifact.claims,
  };
  const artifactBytes = stableJson(bundle.artifact);
  const receipt = await createScheduleSupplyReceipt({
    release: bundle.release,
    artifact: bundle.artifact,
    artifactPath: artifactRepositoryPath,
    artifactFileSha256: sha256(artifactBytes),
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
  });

  writeOrCheck(sourceManifestPath, stableJson(sourceManifest), checkOnly);
  writeOrCheck(inclusionManifestPath, stableJson(bundle.inclusionManifest), checkOnly);
  writeOrCheck(canonicalPath, stableJson(canonicalDataset), checkOnly);
  writeOrCheck(releasePath, stableJson(bundle.release), checkOnly);
  writeOrCheck(artifactPath, artifactBytes, checkOnly);
  writeOrCheck(receiptPath, stableJson(receipt), checkOnly);
  process.stdout.write(
    `${checkOnly ? "Validated" : "Generated"} Vietnam schedule supply ${bundle.release.releaseId}\n`,
  );
}

await main();
