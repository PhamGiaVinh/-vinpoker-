# Protected exact migration cutover (owner-only)

Status: source-only. Daybreak, DB apply, Edge deploy, frontend deploy and every production flag remain OFF. This runbook never authorizes production work by itself.

## Frozen identities

Use only `.github/workflows/protected-nine-exact-apply.yml` on `main`, with the reviewed release SHA, exact project `orlesggcjamwuknxwcpk`, exact filename and normalized hash from `supabase/migration-control/manifest.json`. One dispatch applies one entry. Never use the unrelated Ops 1359 42-entry manifest, broad `db push`, ledger repair, receipt deletion or migration rewriting.

Before every entry: owner approval; fresh recovery workflow (snapshot no older than one hour, encrypted artifact present, isolated restore PASS); no competing release; exact live ledger names; dependencies and previous postchecks PASS. After every entry: archive workflow receipt, check migration-specific object/ACL result, confirm flags remain OFF, then STOP for owner review.

## Ordered cutover and stop gates

1. `00001` Dealer Swing DB containment. Enter a maintenance window: stop cron/event invocations before the DB change. Postcheck, then deploy exactly the reviewed SHA of `process-swing`, `process-swing-on-dealer-ready`, and `run-dealer-ready-backup`; deploy the same frontend SHA containing `operator_perform_swing`. Resume only after deployed versions/digests and TEST operator/worker/pre-assigned/idempotency smokes pass. STOP on any active old worker, source/version mismatch, malformed/timeout response, auth error or unexpected live-row delta; do not mutate any named live dealer or table.
2. `00002` TV Stage A guarded RPCs. Its preflight proves the exact legacy reader/ACL contract. Deploy a compatible frontend exact SHA, then dispatch `tv-stage-a-production-uat.yml`; that protected workflow independently verifies the Production deployment SHA and runs public plus authenticated read-only RPC checks. **HOLD.**
3. `00003` TV Stage B direct-write revoke. Supply the successful Stage A UAT workflow run ID. The apply workflow downloads and validates its exact nonexpired metadata artifact, deployed SHA and authenticated/public results; free-text PASS/SHA inputs are not accepted. Postcheck direct UPDATE and legacy RPC execution are revoked. STOP.
4. `00004` History queue foundation. Keep worker/feature OFF; verify queue/RLS/trigger/RPC ACL. STOP.
5. `00005` correction authority. Keep correction flag OFF; verify tenant/actor authority using TEST data. STOP.
6. `00006` history audit fixes. Keep dispatcher OFF; verify immutable snapshot/receipt and public-history ACL. STOP.
7. `00007` Floor V3 consistency. Keep Floor V3 flag OFF; verify inventory/roster/planner/writer ACL and no seat/chip mutation. STOP.
8. `00008` Tracker Voice authority. Keep Voice/Telegram mutation OFF; verify exact live predecessor digest and TEST authorization. STOP.
9. `00009` history reparent invalidation. Keep worker OFF; verify revision triggers without rewriting historical receipts. STOP.
10. `00010` Multi-day child-trigger binding repair. Keep every feature flag at its captured value; verify all four End Play triggers remain enabled and `hand_actions` resolves both OLD and NEW tournaments through `tournament_hands.hand_id`. STOP.

## Forward-only containment

The exact per-entry containment action and postcheck SQL live in `scripts/ops/protected-nine-postchecks.json`. On any failure or unknown acknowledgement: stop consumers/keep flags OFF, preserve receipts and audit data, collect metadata-only evidence, and create a new reviewed forward migration. The apply job always runs metadata-only reconciliation after a possible response loss and never retries the migration automatically. A database restore is only an owner data-loss decision after assessing intervening writes; it is never automatic.

## Evidence boundary before owner approval

The disposable PostgreSQL 17 gate restores the protected sanitized production-schema capture, applies the complete exact migration sequence in order, checks every staged catalog/object contract, and exercises every required runtime domain on that same intact database.

The integrated suites must not bootstrap or replace pre-release schemas/functions. Dealer Swing, TV, History queue/audit, correction, Floor and Tracker Voice each emit an independent PASS against the restored database; any missing, inconclusive or not-measured domain result is a stop gate. This disposable proof does not authorize production apply, deploy or flag changes.
