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
  createD1ACorrectionRecord,
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
const correctionPath = resolve(
  releaseRoot,
  "corrections/d1a-correction-001-center-p-after-dark.json",
);
const artifactRepositoryPath =
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.json";
const SUPERSEDED_D1A_IDENTITIES = {
  releaseId:
    "series-market:v1:vietnam-schedule-supply:v1:release:dbd23425e5318a23e07779e2a448120a6c361b16149c90c0ef9481ca816ac150",
  artifactId:
    "series-market:v1:vietnam-schedule-supply:v1:artifact:62a3ec31affac9cf655242f364107b1fbc34b56bf346696d168e39fac0c23c72",
  artifactFileSha256: "dc656a5bca1cde8a657ad79e5cf1631c422ec496f9a055caff3be7157a4c8ca8",
  receiptId:
    "series-market:v1:vietnam-schedule-supply:v1:receipt:240651066c3352afdc16803733cb7bbefbeace72ca495eaedaac075b38a55cc5",
} as const;

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
  const correction = await createD1ACorrectionRecord({
    correctedAt: "2026-07-28T15:56:43.914Z",
    originalMergeCommit: "8ea4e3594cbfdddddf490117d4f64493ea86c5d1",
    superseded: SUPERSEDED_D1A_IDENTITIES,
    corrected: {
      release: bundle.release,
      artifact: bundle.artifact,
      receipt,
    },
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
    events: VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
    affected: {
      sourceId: "center-p-jul-17-2026",
      eventKey: "center-p-after-dark",
      field: "prize_contribution",
      supersededClaimId:
        "series-market:v1:vietnam-schedule-supply:v1:claim:d52765f3d54f786cac6eeddb33e727a9dd57ee592b014b2ff3ec9624ae03a4c9",
      oldMinorUnits: "3000000",
      newMinorUnits: "2000000",
      currency: "VND",
      scale: 0,
      reason: "confirmed visual transcription correction",
      preservedSourceImageSha256:
        "ae86830b97335debcf88e480bc0cf20572426af76ae8456aa2108e88da602cca",
    },
    previousMetrics: {
      eventRequiredEntries: "10",
      seriesDateRequiredEntries: "1114",
      within14DayCollisionRequiredEntries: "2266",
    },
  });

  writeOrCheck(sourceManifestPath, stableJson(sourceManifest), checkOnly);
  writeOrCheck(inclusionManifestPath, stableJson(bundle.inclusionManifest), checkOnly);
  writeOrCheck(canonicalPath, stableJson(canonicalDataset), checkOnly);
  writeOrCheck(releasePath, stableJson(bundle.release), checkOnly);
  writeOrCheck(artifactPath, artifactBytes, checkOnly);
  writeOrCheck(receiptPath, stableJson(receipt), checkOnly);
  writeOrCheck(correctionPath, stableJson(correction), checkOnly);
  process.stdout.write(
    `${checkOnly ? "Validated" : "Generated"} Vietnam schedule supply ${bundle.release.releaseId}\n`,
  );
}

await main();
