import {
  SERIES_MARKET_CONTRACT_VERSION,
  type DatasetRelease,
} from "./contracts";
import { createDatasetReleaseId } from "./identity";
import {
  compareCanonicalStrings,
  normalizeInstant,
  SeriesMarketValidationError,
} from "./normalization";
import type { JejuImportDataset } from "./importer";

export interface JejuDatasetReleaseInput {
  readonly sourceCutoff: string;
  readonly notes: string;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const sorted = [...values].sort(compareCanonicalStrings);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new SeriesMarketValidationError(`${label} contains a duplicate ID`, "RELEASE_DUPLICATE_ID");
    }
  }
  return sorted;
}

function assertSameIds(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualSorted = sortedUnique(actual, label);
  const expectedSorted = sortedUnique(expected, label);
  if (actualSorted.length !== expectedSorted.length || actualSorted.some((id, index) => id !== expectedSorted[index])) {
    throw new SeriesMarketValidationError(`${label} does not reference the complete imported dataset`, "RELEASE_REFERENCE_MISMATCH");
  }
}

function datasetEntityIds(dataset: JejuImportDataset): readonly string[] {
  return [...dataset.festivals, ...dataset.events].map((entity) => entity.id);
}

export async function assembleJejuDatasetRelease(
  dataset: JejuImportDataset,
  input: JejuDatasetReleaseInput,
): Promise<DatasetRelease> {
  const sourceCutoff = normalizeInstant(input.sourceCutoff);
  const notes = input.notes.normalize("NFC").trim();
  if (notes === "") throw new SeriesMarketValidationError("release notes must not be blank", "RELEASE_NOTES_REQUIRED");
  const entityIds = sortedUnique(datasetEntityIds(dataset), "entityIds");
  const claimIds = sortedUnique(dataset.claims.map((claim) => claim.id), "claimIds");
  const sourceRevisionIds = sortedUnique(dataset.sourceRevisions.map((revision) => revision.id), "sourceRevisionIds");
  const id = await createDatasetReleaseId({ marketKey: "jeju", sourceCutoff, entityIds, claimIds, sourceRevisionIds });
  return {
    id,
    contractVersion: SERIES_MARKET_CONTRACT_VERSION,
    marketKey: "jeju",
    sourceCutoff,
    entityIds: [...entityIds],
    claimIds: [...claimIds],
    sourceRevisionIds: [...sourceRevisionIds],
    parentReleaseId: null,
    notes,
  };
}

export async function validateJejuDatasetRelease(
  dataset: JejuImportDataset,
  release: DatasetRelease,
): Promise<void> {
  if (release.contractVersion !== SERIES_MARKET_CONTRACT_VERSION) {
    throw new SeriesMarketValidationError("release contract version is unsupported", "RELEASE_CONTRACT_VERSION_MISMATCH");
  }
  if (release.marketKey !== "jeju") throw new SeriesMarketValidationError("release market must be jeju", "RELEASE_MARKET_MISMATCH");
  if (release.parentReleaseId !== null) throw new SeriesMarketValidationError("Jeju v1 release cannot have a parent", "RELEASE_PARENT_NOT_ALLOWED");
  normalizeInstant(release.sourceCutoff);
  assertSameIds(release.entityIds, datasetEntityIds(dataset), "entityIds");
  assertSameIds(release.claimIds, dataset.claims.map((claim) => claim.id), "claimIds");
  assertSameIds(release.sourceRevisionIds, dataset.sourceRevisions.map((revision) => revision.id), "sourceRevisionIds");
  const recomputed = await createDatasetReleaseId({
    marketKey: release.marketKey,
    sourceCutoff: release.sourceCutoff,
    entityIds: release.entityIds,
    claimIds: release.claimIds,
    sourceRevisionIds: release.sourceRevisionIds,
  });
  if (recomputed !== release.id) throw new SeriesMarketValidationError("release identity does not recompute", "RELEASE_ID_MISMATCH");
}
