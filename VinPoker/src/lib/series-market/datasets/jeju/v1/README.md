# Jeju Public Dataset Release V1

This release is an unverified public seed dataset for importer and descriptive research testing. It is not official ground truth and must not be used to claim causality, verified rake elasticity, overlay probability, player-level behavior, or operator profitability.

## Source

- Raw evidence: `raw/jeju_events_seed_v0.csv`
- SHA-256: `29281850cde2dd52f1a8a91eeb5d25740dee8e7e75fb1497ab487119012db3c8`
- Size: 12,949 bytes
- Rows: 87 events
- Columns: 19
- Festivals: 5
- Tours: 3
- Currencies: KRW and USD
- Event date range: `2025-07-04` through `2026-02-08`
- Evidence caveat: owner-provided seed data without row-level official URLs

The source document is `jeju-events-seed-v0`, revision `v0`, classified as `other_public`, `reported`, `unverified`, and `unknown` confidence. Its canonical URL is intentionally null. The committed `source-manifest.json` is the only source of the frozen ingestion timestamp, `2026-07-14T19:36:11.341Z`. `sourceCutoff` means the time the seed entered the evidence system, not the latest event date and not a later regeneration time.

## Identity Policy

Festival names use the explicit mapping in `jejuSeedAdapter.ts`:

| Source festival | Stable key |
| --- | --- |
| APT Jeju 2025 (Sept) | `apt-jeju-2025-sept` |
| APT Jeju Classic 2026 | `apt-jeju-classic-2026` |
| RDPT Jeju II 2025 | `rdpt-jeju-ii-2025` |
| Triton One 2025 | `triton-one-jeju-2025` |
| Triton SHRS Jeju II 2025 | `triton-shrs-jeju-ii-2025` |

The adapter fails closed for an unmapped name, a mapping collision, or inconsistent tour or venue values within one festival. Event keys use `event-{canonical event_no}` after validating uniqueness within each festival. This is the identity policy for seed release V1, not a promise that event numbers remain stable across future schedule revisions.

## Claims

The adapter emits one claim for every mapped field, including blank source cells:

- 972 claims total: 15 festival claims and 957 event claims
- 794 non-missing claims
- 178 explicit missing claims: `buy_in_prize` 49, `organizer_fee` 49, `gtd` 80
- Every claim uses the committed CSV source revision, `observedAt` from the frozen manifest timestamp, and `effectiveAt: null`
- Missing values use `{ type: "missing", reason: "unknown" }` and remain distinct from zero
- Money values are normalized by string only; all-zero fractions such as `734910.0` become `734910`, and non-zero fractions, exponent notation, `NaN`, `Infinity`, commas, and localized formats are rejected

The legacy columns `buy_in_usd`, `fee_pct`, `value_ratio`, and `ln_entries` are omitted. No unsourced FX conversion or derived metric is emitted.

## Artifacts

`canonical/jeju_import_v1.json` is the sole authoritative canonical import artifact. The raw CSV remains evidence input, not canonical import. `release.json` is the deterministic `DatasetRelease` manifest and `data-quality.json` is the deterministic quality report. All generated JSON uses canonical key ordering, deterministic row and ID ordering, a final newline, and no generated-at timestamp.

## Regeneration

Run from `VinPoker`:

```powershell
npx --no-install vite-node scripts/series-market/generateJejuDatasetRelease.ts
npx --no-install vite-node scripts/series-market/generateJejuDatasetRelease.ts --check
```

The generator imports the shared adapter and release validation logic. It reads `source-manifest.json` on every run and never calls `Date.now()`. No `tsx`, `ts-node`, package change, or lockfile change is required. Where npm bin shims are unavailable, the equivalent existing-tool invocation is:

```powershell
node node_modules/vite-node/vite-node.mjs scripts/series-market/generateJejuDatasetRelease.ts --check
```

The release is intended for importer and descriptive research tests only. It does not add a runtime caller, UI, feature flag, database object, network importer, scraper, forecast, calibration, agent framework, or deployment behavior.
