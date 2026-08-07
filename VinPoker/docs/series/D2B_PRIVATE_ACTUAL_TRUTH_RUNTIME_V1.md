# D2B Private Actual Truth Runtime V1

## Purpose

D2B turns an owner-authorized native tournament snapshot into append-only D2A actual-revision truth. It is source-only: this increment adds no UI, feature flag, production data, migration apply, deployment, or forecast score.

## Mutable Cache Versus Truth

`series_event_actuals`, decision logs, registration journals, and capture runs are operational cache or logs. D2B never promotes them. It reads the native tournament and confirmed-registration tables server-side and writes a new immutable row only to `series_event_actual_revisions_v1`.

## Native Contracts

- `native-tournament-confirmed-registration-v1`: one confirmed registration row is one entry/bullet; entries and total bullets are the row count, unique players are distinct player identities, and re-entries are bullets minus unique players.
- `native-confirmed-prize-contribution-v1`: `tournament_registrations.buy_in` is prize contribution. `platform_fixed_fee` and `total_pay` never enter prize-pool or guarantee-shortfall calculation.
- Currency is explicit VND with scale 0. No FX, floating-point conversion, planned paid places, or inferred fee allocation is used.

## Promotion And Correction

`series_promote_native_event_actual_v1` requires an authenticated club owner. It derives an exact source fingerprint from native state, takes an event advisory lock, returns the existing head when semantic source state is unchanged, and otherwise appends one successor with `native_source_recomputed`. Completed events can be final; active events are only provisional; cancelled or unknown states fail closed.

## Manual Reconciliation

Manual and auto revisions are never overwritten. `series_reconcile_event_actual_v1` requires current compatible heads, deterministic locking, explicit field-by-field resolution, and a nonblank owner reason for manual or blocked conflict resolution. Matching values create `matching`; an unresolved difference records `blocked_conflict`, which remains non-scoring.

## Active Truth And Scoring

Resolution prefers a current reconciled head only when it still references current auto and manual heads. Otherwise it reports reconciliation-required, stale-reconciliation, explicit conflict, auto-only, manual-only, or unavailable. `resolveForecastActualScoringPairV1` only marks an entries/unique-player/total-bullets pair eligible when the packet is frozen, forecast provenance is identity-eligible, actual scope is `event_total`, finality is final/corrected, exact outcome time is after the packet cutoff, and the target metric is present.

## Local Typed Boundary And Privacy

`decisionPacketRpc.ts` is the only D2B Supabase boundary. It permits exactly three named RPCs and validates versioned read responses with `decisionPacketRuntimeTypes.ts`. This isolated cast is temporary until a separately trusted generated-type synchronization. Public Market Intelligence and UI do not import D2B. Read responses exclude player identities, registration rows, known-information JSON, request hashes, and capture metadata.

## Migration And Rollback

Apply `20270108000002_series_private_actual_truth_runtime_v1.sql` only through the owner-controlled database runbook after review and disposable PostgreSQL 17 evidence. Before any D2B row exists, rollback is to revoke the three public RPCs and remove D2B-only tables/functions after a dependency audit. After records exist, rollback is forward-only: preserve immutable history and disable callers rather than deleting truth.

## Next Controlled Step

After D2B is merged and its production migration has an owner-gated apply/UAT evidence trail, D2C may introduce a read-only Decision Room UI behind a default-off flag. D2B itself does not enable that work.
