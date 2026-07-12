# B2-PR2 Forecast Provenance Schema

Status: migration applied through the owner-gated targeted path; B2-PR3 capture/UI wiring remains flag-off pending Preview UAT.

## Migration

- File: `VinPoker/supabase/migrations/20261239000000_series_forecast_provenance_schema.sql`
- Version: `20261239000000`
- Scope: additive nullable provenance/timing storage on `public.series_forecast_snapshots`
- Explicitly out of scope: app wiring, snapshot capture changes, RPC, Edge Functions, UI, feature flags, generated Supabase types, DB apply, `supabase db push`, B2-PR3, B3, B1

## Version Collision Proof

- Local migration inventory found existing duplicate historical versions, but no local `20261239000000_*` file before this migration.
- `origin/main` was checked for `VinPoker/supabase/migrations/20261239000000_*`; none existed before this migration.
- Current open PR branches were checked during authoring, including the open settlement migration-collision PR; none used this version.

## Columns

All new columns are nullable and have no defaults.

- Timing: `forecast_issued_at timestamptz`, `as_of_ts timestamptz`, `target_event_ts timestamptz`
- Classification: `provenance_kind text`, `provenance_completeness text`, `forecast_identity_eligible boolean`
- Predictor metadata: `engine_version text`, `feature_schema_version text`, `code_sha text`, `model_config_hash text`, `trial_count integer`, `selection_protocol_id text`
- Identity hashes: `predictor_id text`, `calibration_pool_id text`, `target_input_hash text`, `training_data_hash text`, `input_content_hash text`, `forecast_instance_id text`, `derived_from_input_hash text`

## Constraints

- `provenance_kind`: nullable or one of `engine`, `manual_override`, `manual`
- `provenance_completeness`: nullable or one of `complete`, `missing_code_sha`, `legacy`, `manual`
- Hash fields: nullable or lowercase 64-hex
- `code_sha`: nullable, `unknown`, or lowercase 7-64 hex
- `selection_protocol_id`: nullable or stable lowercase machine id matching the B2 contract
- `trial_count`: nullable or positive integer
- Timing: `as_of_ts <= forecast_issued_at` when both are present
- `provenance_kind IS NULL`: only all-null legacy rows are valid, with optional `provenance_completeness = 'legacy'`; timing, predictor metadata, hashes, and derived lineage must remain null, and identity eligibility cannot be true.
- Manual rows: require all three timing fields, `provenance_completeness = 'manual'`, `forecast_identity_eligible = false`, and no predictor/input identity, engine metadata, or derived input hash.
- Engine and manual-override rows: require all timing fields, non-empty engine and feature-schema versions, code SHA, model config hash, positive trial count, selection protocol, every identity hash, and explicit identity eligibility.
- Engine/manual-override completeness pairing: `missing_code_sha` iff `code_sha = 'unknown'`; `complete` iff `code_sha` is lowercase 7-64 hex and not `unknown`. `legacy` and `manual` completeness are rejected for engine lineage.
- Engine rows: require `derived_from_input_hash IS NULL` and `forecast_identity_eligible = (provenance_completeness = 'complete')`.
- Manual overrides: require `derived_from_input_hash IS NOT NULL`, retain the full engine predictor/input/timing identity, and require `forecast_identity_eligible = false`.
- `forecast_identity_eligible = true`: requires complete engine provenance, all three timing fields, non-empty predictor metadata, and the full identity hash set. This is only B2 forecast identity, not final B1 calibration eligibility.

## Index Rationale

- `idx_sfs_forecast_instance_id_unique`: partial unique index on `forecast_instance_id` where not null, because each issued forecast instance is an immutable identity and duplicate instance ids would corrupt scoring lineage.
- `idx_sfs_calibration_pool_id`: partial lookup index where not null, because B1 calibration will group comparable forecasts by calibration pool.
- No target/as-of timing indexes were added in this slice. The task has no reader/query path yet, so those would be speculative.

## Live Schema Snapshot During Authoring

Read-only Supabase inspection succeeded through `supabase db query --linked`.

- Live `public.series_forecast_snapshots` had only capture-v0 columns at inspection time.
- Live `supabase_migrations.schema_migrations` had no `20261239000000` row, and the provenance columns were absent from `information_schema.columns`.
- Live row count returned `0`.
- Live constraints matched capture-v0 checks and FKs.
- Live indexes were `idx_sfs_club`, `idx_sfs_event`, and the primary key.
- This pre-apply state selects hardening of the existing migration file in the follow-up PR; no additive migration is needed.
- `supabase db dump --linked --schema public` was attempted but blocked by missing Docker Desktop, so DB execution of the new migration was not verified through a dump or local Postgres run.

## Controlled Apply Record

- Source follow-up PR: #889, merged as `f3a439e29516b567795de29621d70a0b5b408a31`.
- Final migration SHA-256: `98919C5FBBC1CFA42213AE77ED4A8276D8EC1BCB5101EB614B225DE58CCE3DFC`.
- Exact SQL execution succeeded via `supabase db query --linked --file supabase/migrations/20261239000000_series_forecast_provenance_schema.sql`.
- Official history reconciliation succeeded via `supabase migration repair --linked --status applied 20261239000000`; live ledger now contains `20261239000000`.
- Post-apply catalog verification: 19 nullable provenance columns, 14 provenance constraints, 2 provenance indexes, and 0 snapshot rows.
- PostgreSQL rollback-only probe passed 22/22 valid and invalid provenance cases; the probe transaction was rolled back and wrote no persistent rows.
- DB execution is now verified for this migration. Local `supabase db dump`/Docker execution remains unavailable; the live catalog and rollback-only probe are the evidence used here.

## Static Test Coverage

`forecastProvenanceSchemaMigration.test.ts` checks the migration SQL text for each discriminator shape predicate, including null-kind legacy rows, exact manual rows, complete engine rows, missing-code engine rows, and full-identity manual overrides. It also keeps a JavaScript mirror for positive and negative examples, but that mirror is only illustrative; it is not reported as PostgreSQL execution.

Covered negative examples include manual rows with null timing or null eligibility, sparse engine rows, engine rows with `legacy` or `manual` completeness, blank engine/feature-schema versions, bad completeness/code-SHA pairings, sparse manual overrides, null-kind partial identity rows, and identity-eligible rows missing timing.

## Owner-Gated Apply Runbook

1. Confirm the live ledger and catalog still match the apply record before any dependent rollout.
2. Regenerate only the expected public Supabase type additions in the wiring PR; live drift outside B2 must not be committed.
3. Keep capture wiring and provenance UI behind `seriesForecastProvenance = false` until Preview UAT.
4. Do not flip the flag or create a forecast snapshot in this source PR.

## Rollback Notes

Rollback must also be owner-gated. If the migration must be removed after apply, use an explicit reviewed rollback that drops only the two new indexes, the new provenance constraints, and the new columns from `public.series_forecast_snapshots`. No rollback was executed in this source-only PR.
