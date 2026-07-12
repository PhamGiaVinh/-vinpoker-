# B2-PR2 Forecast Provenance Schema

Status: source-only draft PR material. Do not apply to production until owner DB review is complete.

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
- Manual rows: no predictor/input identity, no engine metadata, no derived input hash, not identity eligible
- Manual overrides: must retain `derived_from_input_hash`, never identity eligible
- Engine rows: cannot carry `derived_from_input_hash`
- `forecast_identity_eligible = true`: requires complete engine provenance and full identity hash set. This is only B2 forecast identity, not final B1 calibration eligibility.

## Index Rationale

- `idx_sfs_forecast_instance_id_unique`: partial unique index on `forecast_instance_id` where not null, because each issued forecast instance is an immutable identity and duplicate instance ids would corrupt scoring lineage.
- `idx_sfs_calibration_pool_id`: partial lookup index where not null, because B1 calibration will group comparable forecasts by calibration pool.
- No target/as-of timing indexes were added in this slice. The task has no reader/query path yet, so those would be speculative.

## Live Schema Snapshot During Authoring

Read-only Supabase inspection succeeded through `supabase db query --linked`.

- Live `public.series_forecast_snapshots` had only capture-v0 columns at inspection time.
- Live row count returned `0`.
- Live constraints matched capture-v0 checks and FKs.
- Live indexes were `idx_sfs_club`, `idx_sfs_event`, and the primary key.
- `supabase db dump --linked --schema public` was attempted but blocked by missing Docker Desktop, so DB execution of the new migration was not verified through a dump or local Postgres run.

## Owner-Gated Apply Runbook

1. Confirm owner approval to review/apply this exact migration.
2. Re-run read-only live schema checks for `public.series_forecast_snapshots`.
3. Re-run migration version collision scan against `origin/main` and open PRs.
4. Apply only this migration through the controlled DB path approved by owner.
5. Verify the new columns, constraints, and indexes through catalog queries.
6. Do not regenerate Supabase types, wire capture code, flip flags, or ship UI in this apply step.

## Rollback Notes

Rollback must also be owner-gated. If the migration must be removed after apply, use an explicit reviewed rollback that drops only the two new indexes, the new provenance constraints, and the new columns from `public.series_forecast_snapshots`. No rollback was executed in this source-only PR.
