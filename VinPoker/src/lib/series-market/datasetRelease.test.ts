import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleJejuDatasetRelease, validateJejuDatasetRelease } from "./datasetRelease";
import { importJejuSeed, type JejuSeedSourceManifest } from "./jejuSeedAdapter";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");
const raw = readFileSync(join(RELEASE_ROOT, "raw/jeju_events_seed_v0.csv"), "utf8");
const manifest = JSON.parse(readFileSync(join(RELEASE_ROOT, "source-manifest.json"), "utf8")) as JejuSeedSourceManifest;

describe("Jeju DatasetRelease V1", () => {
  it("assembles and validates a sorted, reproducible release", async () => {
    const { dataset } = await importJejuSeed(raw, manifest);
    const release = await assembleJejuDatasetRelease(dataset, {
      sourceCutoff: manifest.retrievedAt,
      notes: "Unverified public Jeju seed release for importer and descriptive research testing.",
    });
    await validateJejuDatasetRelease(dataset, release);
    expect(release.id).toBe("series-market:v1:release:jeju:20ba969d8df146c54a47354700a36d94f81ddb51f0eca4824dafda07c907e203");
    expect(release.entityIds).toEqual([...release.entityIds].sort());
    expect(release.claimIds).toEqual([...release.claimIds].sort());
    expect(release.sourceRevisionIds).toEqual([...release.sourceRevisionIds].sort());
    expect(new Set(release.entityIds).size).toBe(release.entityIds.length);
    expect(new Set(release.claimIds).size).toBe(release.claimIds.length);
    expect(new Set(release.sourceRevisionIds).size).toBe(release.sourceRevisionIds.length);
  }, 30_000);

  it("keeps release identity stable across equivalent input ordering without mutation", async () => {
    const { dataset } = await importJejuSeed(raw, manifest);
    const before = structuredClone(dataset);
    const first = await assembleJejuDatasetRelease(dataset, {
      sourceCutoff: manifest.retrievedAt,
      notes: "Unverified public Jeju seed release for importer and descriptive research testing.",
    });
    const reordered = {
      ...dataset,
      festivals: [...dataset.festivals].reverse(),
      events: [...dataset.events].reverse(),
      sourceDocuments: [...dataset.sourceDocuments].reverse(),
      sourceRevisions: [...dataset.sourceRevisions].reverse(),
      claims: [...dataset.claims].reverse(),
    };
    const second = await assembleJejuDatasetRelease(reordered, {
      sourceCutoff: manifest.retrievedAt,
      notes: "Unverified public Jeju seed release for importer and descriptive research testing.",
    });
    expect(second.id).toBe(first.id);
    expect(dataset).toEqual(before);
  }, 30_000);

  it("rejects duplicate release references instead of silently deduplicating them", async () => {
    const { dataset } = await importJejuSeed(raw, manifest);
    const release = await assembleJejuDatasetRelease(dataset, {
      sourceCutoff: manifest.retrievedAt,
      notes: "Unverified public Jeju seed release for importer and descriptive research testing.",
    });
    await expect(validateJejuDatasetRelease(dataset, {
      ...release,
      claimIds: [...release.claimIds, release.claimIds[0] ?? ""],
    })).rejects.toMatchObject({ code: "RELEASE_DUPLICATE_ID" });
  }, 30_000);
});
